import { spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import { ollamaBaseUrl, ollamaTags, resolveTarget } from 'ollanet';
import { configPath, type DictaConfig } from '../config.ts';
import { apiListenHost, discoverTailscale, inboxUrls } from './tailscaleLib.ts';
import { getWhisperWorkerStatus, resolveWhisperModel } from './whisperLib.ts';
import { getJournalIndex, openJournalIndex } from './journalIndexLib.ts';

export type HealthLevel = 'ok' | 'warn' | 'fail';

export type HealthCheck = {
  id: string;
  level: HealthLevel;
  message: string;
};

export type HealthMode = 'doctor' | 'startup' | 'live';

export type HealthReport = {
  ok: boolean;
  degraded: boolean;
  node: string;
  configPath: string;
  whisper: {
    model: string;
    device: string;
    computeType: string;
    python: string;
    worker: ReturnType<typeof getWhisperWorkerStatus>;
  };
  ollanet: {
    machine: string;
    model: string;
    reachable: boolean;
  };
  http: { host: string; port: number };
  checks: HealthCheck[];
};

const LIVE_CACHE_MS = 30_000;
const PYTHON_PROBE_MS = 45_000;
const OLLANET_RESOLVE_MS = 12_000;
const OLLANET_TAGS_MS = 8_000;

let liveCache: { at: number; report: HealthReport } | null = null;

function add(checks: HealthCheck[], id: string, level: HealthLevel, message: string): void {
  checks.push({ id, level, message });
}

function pythonOnPath(name: string): boolean {
  return name === 'python' || name === 'python3' || name === 'py';
}

function spawnPython(
  python: string,
  args: string[],
  timeout = PYTHON_PROBE_MS
): { status: number | null; stdout: string; stderr: string; error?: string } {
  const result = spawnSync(python, args, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  if (result.error) {
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error.message };
  }
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function probePort(host: string, port: number): Promise<'free' | 'in-use' | 'error'> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'EADDRINUSE' ? 'in-use' : 'error');
    });
    server.listen(port, host, () => {
      server.close(() => resolve('free'));
    });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function modelListed(tags: { name: string }[], model: string): boolean {
  const want = model.trim().toLowerCase();
  return tags.some((tag) => {
    const name = tag.name.toLowerCase();
    return name === want || name.startsWith(`${want}:`) || name.startsWith(`${want}-`);
  });
}

async function probeOllanet(
  machine: string,
  model: string
): Promise<{ reachable: boolean; message: string; level: HealthLevel }> {
  try {
    const host = await withTimeout(
      resolveTarget(machine),
      OLLANET_RESOLVE_MS,
      `timed out resolving ${machine}`
    );
    const baseUrl = ollamaBaseUrl(host);
    const tags = await ollamaTags(baseUrl, OLLANET_TAGS_MS);
    if (model && !modelListed(tags, model)) {
      return {
        reachable: true,
        level: 'warn',
        message: `ollanet ${machine} is up; model ${model} not in /api/tags`,
      };
    }
    return {
      reachable: true,
      level: 'ok',
      message: `ollanet ${machine} / ${model} (${tags.length} models)`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      reachable: false,
      level: 'warn',
      message: `ollanet ${machine} unreachable (${detail}) — cleanup degraded; raw transcripts still work`,
    };
  }
}

export async function collectHealth(
  config: DictaConfig,
  options: { mode: HealthMode } = { mode: 'startup' }
): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    add(checks, 'node', 'fail', `node ${process.version} (need >= 20)`);
  } else {
    add(checks, 'node', 'ok', `node ${process.version}`);
  }

  add(checks, 'config', 'ok', `config ${configPath}`);

  if (!config.watch.roots.length) {
    add(checks, 'watch-roots', 'ok', 'no extra watch roots (browser record/drop only)');
  }
  for (const root of config.watch.roots) {
    if (fs.existsSync(root)) {
      add(checks, 'watch-root', 'ok', `watch root ${root}`);
      continue;
    }
    if (config.watch.createMissingRoots) {
      fs.mkdirSync(root, { recursive: true });
      add(checks, 'watch-root', 'ok', `watch root ${root} (created)`);
      continue;
    }
    add(checks, 'watch-root', 'fail', `watch root missing ${root}`);
  }

  const drop = config.watch.browserDropFolder;
  if (!fs.existsSync(drop)) {
    fs.mkdirSync(drop, { recursive: true });
    add(checks, 'browser-drop', 'ok', `browser drop ${drop} (created)`);
  } else {
    add(checks, 'browser-drop', 'ok', `browser drop ${drop}`);
  }

  const python = config.whisper.python;
  const pythonExists = pythonOnPath(python) || fs.existsSync(python);
  if (!pythonExists) {
    add(checks, 'python', 'fail', `python not found: ${python}`);
  } else {
    const version = spawnPython(python, ['--version'], 15_000);
    if (version.status !== 0) {
      add(checks, 'python', 'fail', `python failed (${version.error || version.stderr || `exit ${version.status}`}): ${python}`);
    } else {
      const fw = spawnPython(python, [
        '-c',
        'import faster_whisper; print(getattr(faster_whisper, "__version__", "ok"))',
      ]);
      if (fw.status !== 0) {
        add(
          checks,
          'faster-whisper',
          'fail',
          `faster-whisper import failed (${fw.error || fw.stderr || `exit ${fw.status}`})`
        );
      } else {
        add(checks, 'faster-whisper', 'ok', `python ${python} (faster-whisper ${fw.stdout || 'ok'})`);
      }

      const cuda = spawnPython(python, ['-c', 'import ctranslate2; print(ctranslate2.get_cuda_device_count())']);
      const device = (config.whisper.device || 'cuda').toLowerCase();
      if (cuda.status !== 0) {
        add(
          checks,
          'device',
          'warn',
          `could not probe CUDA (${cuda.error || cuda.stderr || `exit ${cuda.status}`}); device=${device}`
        );
      } else {
        const count = Number(cuda.stdout);
        if (device === 'cpu') {
          add(checks, 'device', 'warn', 'whisper device=cpu (slow; raw mode still works)');
        } else if (!Number.isFinite(count) || count <= 0) {
          add(
            checks,
            'device',
            'warn',
            `whisper device=${device} but 0 CUDA devices — set whisper.device=cpu or fix the GPU driver`
          );
        } else {
          add(checks, 'device', 'ok', `whisper device=${device} (${count} CUDA device${count === 1 ? '' : 's'})`);
        }
      }
    }
  }

  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (ffmpeg.status === 0) {
    const version = (ffmpeg.stdout || '').match(/ffmpeg version (\S+)/i)?.[1];
    add(checks, 'ffmpeg', 'ok', version ? `ffmpeg ${version}` : 'ffmpeg on PATH');
  } else if (config.audio.preprocess) {
    add(checks, 'ffmpeg', 'fail', 'ffmpeg not on PATH (denoise will fail)');
  } else {
    add(checks, 'ffmpeg', 'warn', 'ffmpeg not on PATH (preprocess is off)');
  }

  const machine = config.ollanet.machine.trim();
  const model = config.ollanet.cleanModel.trim();
  const configured =
    machine.length > 0 && !machine.startsWith('YOUR-') && model.length > 0 && !model.startsWith('YOUR-');
  let ollanetReachable = false;
  if (!configured) {
    add(checks, 'ollanet', 'warn', 'ollanet machine/model not configured — cleanup skipped; raw transcripts still work');
  } else {
    const ping = await probeOllanet(machine, model);
    ollanetReachable = ping.reachable;
    add(checks, 'ollanet', ping.level, ping.message);
  }

  const journalPath = config.journal.index;
  if (!fs.existsSync(journalPath)) {
    add(checks, 'journal-index', 'warn', `journal index missing (${journalPath}); run pnpm journal:index`);
  } else {
    let opened = getJournalIndex();
    let closeAfter = false;
    try {
      if (!opened) {
        opened = openJournalIndex(journalPath);
        closeAfter = true;
      }
      const stats = opened.stats();
      const vec = opened.hasVec()
        ? `, ${stats.embedded} embedded${stats.embedModel ? ` (${stats.embedModel})` : ''}`
        : ', FTS only';
      add(
        checks,
        'journal-index',
        stats.notes > 0 ? 'ok' : 'warn',
        stats.notes > 0
          ? `${stats.notes} notes in SQLite${vec}`
          : `journal index empty (${journalPath})`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      add(checks, 'journal-index', 'fail', `journal index unreadable (${detail})`);
    } finally {
      if (closeAfter) opened?.close();
    }
  }

  if (config.http.tailscale) {
    const self = discoverTailscale();
    if (self) {
      const remote = inboxUrls(config, self).filter((url) => !/localhost|127\.0\.0\.1/.test(url));
      add(checks, 'tailscale', 'ok', `inbox ${remote.join(' ')}; API stays ${apiListenHost(config)}:${config.http.port}`);
    } else {
      add(checks, 'tailscale', 'warn', 'http.tailscale is on but the tailscale CLI did not return an IP; inbox stays on 127.0.0.1');
    }
  }

  const bindHost = apiListenHost(config);
  if (options.mode === 'doctor') {
    const bind = await probePort(bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost, config.http.port);
    if (bind === 'free') {
      add(checks, 'port', 'ok', `port ${bindHost}:${config.http.port} free`);
    } else if (bind === 'in-use') {
      add(checks, 'port', 'warn', `port ${bindHost}:${config.http.port} in use (API may already be running)`);
    } else {
      add(checks, 'port', 'warn', `could not probe port ${bindHost}:${config.http.port}`);
    }
  } else if (options.mode === 'live') {
    add(checks, 'port', 'ok', `listening on ${bindHost}:${config.http.port}`);
    const worker = getWhisperWorkerStatus();
    add(
      checks,
      'whisper-worker',
      worker === 'ready' || worker === 'starting' ? 'ok' : 'warn',
      `whisper worker ${worker}`
    );
  }

  const failed = checks.some((check) => check.level === 'fail');
  const degraded = checks.some((check) => check.level === 'warn');

  return {
    ok: !failed,
    degraded,
    node: process.version,
    configPath,
    whisper: {
      model: resolveWhisperModel(),
      device: config.whisper.device,
      computeType: config.whisper.computeType,
      python,
      worker: getWhisperWorkerStatus(),
    },
    ollanet: {
      machine,
      model,
      reachable: ollanetReachable,
    },
    http: { host: config.http.host, port: config.http.port },
    checks,
  };
}

export async function getHealthReport(
  config: DictaConfig,
  options: { mode: HealthMode; fresh?: boolean } = { mode: 'live' }
): Promise<HealthReport> {
  if (
    options.mode === 'live' &&
    !options.fresh &&
    liveCache &&
    Date.now() - liveCache.at < LIVE_CACHE_MS
  ) {
    return {
      ...liveCache.report,
      whisper: { ...liveCache.report.whisper, worker: getWhisperWorkerStatus() },
    };
  }
  const report = await collectHealth(config, { mode: options.mode });
  if (options.mode === 'live') liveCache = { at: Date.now(), report };
  return report;
}

export function printHealthReport(report: HealthReport, prefix = 'health'): void {
  for (const check of report.checks) {
    const tag = check.level === 'ok' ? 'ok  ' : check.level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${prefix}] ${tag}  ${check.message}`);
  }
  if (!report.ok) {
    console.error(`[${prefix}] fix the failing items above, then retry`);
    return;
  }
  if (report.degraded) {
    console.log(`[${prefix}] ready (degraded — raw mode still works)`);
    return;
  }
  console.log(`[${prefix}] ready`);
}
