import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { localslipGet } from './lib/localslipGet.ts';

export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = os.homedir()
): string {
  const fromEnv = env.DICTA_CONFIG?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const inCwd = path.resolve(cwd, 'config.json');
  if (fs.existsSync(inCwd)) return inCwd;
  const inHome = path.join(home, '.dictawhisper', 'config.json');
  if (fs.existsSync(inHome)) return inHome;
  return inCwd;
}

export const defaultConfigPath = resolveConfigPath();

function resolveAgainst(configDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath);
}

function servePackagedUi(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DICTA_SERVE_UI === '1' || env.DICTA_SERVE_UI === 'true';
}

const httpSchema = z
  .object({
    host: z.string().min(1).default('127.0.0.1'),
    port: z.number().int().positive().default(8008),
    corsOrigins: z.array(z.string()).default(['http://localhost:7777', 'http://127.0.0.1:7777']),
    tailscale: z.boolean().default(false),
  })
  .default({});

const watchSchema = z
  .object({
    roots: z.array(z.string()).default([]),
    browserDropFolder: z.string().default('./data/audio-files'),
    settleMinutes: z.number().nonnegative().default(30),
    browserSettleMs: z.number().nonnegative().default(0),
    recursiveYears: z.boolean().default(true),
    createMissingRoots: z.boolean().default(false),
  })
  .default({});

const whisperSchema = z
  .object({
    python: z.string().min(1).default('python'),
    model: z.string().min(1).default('large-v3'),
    device: z.string().min(1).default('cuda'),
    computeType: z.string().min(1).default('float16'),
    promptTerms: z.array(z.string()).default([]),
  })
  .default({});

const queuesSchema = z
  .object({
    transcription: z.object({ active: z.boolean().default(true), concurrency: z.number().int().positive().default(1) }).default({}),
    processing: z.object({ active: z.boolean().default(true), concurrency: z.number().int().positive().default(1) }).default({}),
  })
  .default({});

const ollanetSchema = z
  .object({
    machine: z.string().default(''),
    cleanModel: z.string().default(''),
    saveChats: z.boolean().default(false),
    required: z.boolean().default(false),
  })
  .default({});

const journalSchema = z
  .object({
    index: z.string().default('./data/journal.sqlite'),
    search: z.enum(['lex', 'semantic', 'hybrid']).default('hybrid'),
    embedModel: z.string().default(''),
    /** 'local' (this computer), 'machine' (ollanet.machine), 'any', or one ollanet host name. */
    embedHost: z.string().default('local'),
  })
  .default({});

export const dictaConfigFileSchema = z
  .object({
    http: httpSchema,
    watch: watchSchema,
    whisper: whisperSchema,
    audio: z.object({ preprocess: z.boolean().default(true) }).default({}),
    queues: queuesSchema,
    ollanet: ollanetSchema,
    journal: journalSchema,
  })
  .strip();

export type DictaConfig = {
  http: {
    host: string;
    port: number;
    corsOrigins: string[];
    tailscale: boolean;
  };
  watch: {
    roots: string[];
    browserDropFolder: string;
    settleMinutes: number;
    browserSettleMs: number;
    recursiveYears: boolean;
    createMissingRoots: boolean;
  };
  whisper: {
    python: string;
    model: string;
    device: string;
    computeType: string;
    promptTerms: string[];
  };
  audio: { preprocess: boolean };
  queues: {
    transcription: { active: boolean; concurrency: number };
    processing: { active: boolean; concurrency: number };
  };
  ollanet: {
    machine: string;
    cleanModel: string;
    saveChats: boolean;
    required: boolean;
  };
  journal: {
    index: string;
    search: 'lex' | 'semantic' | 'hybrid';
    embedModel: string;
    embedHost: string;
  };
};

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`config is not valid JSON (${filePath}): ${detail}`);
  }
}

export function applyConfigToEnv(config: DictaConfig): void {
  process.env.WHISPER_MODEL = config.whisper.model;
  process.env.WHISPER_PYTHON = config.whisper.python;
  process.env.WHISPER_DEVICE = config.whisper.device;
  process.env.WHISPER_COMPUTE_TYPE = config.whisper.computeType;
}

/** LocalSlip start on the UI lease sets PORT=7777. That must not become the API. */
export function resolveApiListenPort(
  envPort: string | undefined,
  uiPort: number | undefined,
  apiLeasePort: number | undefined,
  configPort: number
): number {
  const n = Number(envPort);
  if (Number.isInteger(n) && n > 0 && n !== uiPort) return n;
  return apiLeasePort || configPort;
}

/** Combined inbox+API (npm CLI) binds the UI port so the page and /note share origin. */
export function resolveListenPort(
  envPort: string | undefined,
  uiPort: number | undefined,
  apiLeasePort: number | undefined,
  configPort: number,
  serveUi = false
): number {
  if (serveUi) return uiPort || 7777;
  return resolveApiListenPort(envPort, uiPort, apiLeasePort, configPort);
}

export function loadConfig(configPath: string = resolveConfigPath()): DictaConfig {
  const parsed = dictaConfigFileSchema.parse(readJson(configPath));
  const configDir = path.dirname(path.resolve(configPath));
  const config: DictaConfig = {
    http: {
      host: process.env.HOST?.trim() || parsed.http.host,
      port: resolveListenPort(
        process.env.PORT,
        localslipGet('dictawhisper'),
        localslipGet('dictawhisper-api'),
        parsed.http.port,
        servePackagedUi()
      ),
      corsOrigins: parsed.http.corsOrigins,
      tailscale:
        process.env.DICTA_TAILSCALE === '1' ||
        process.env.DICTA_TAILSCALE === 'true' ||
        parsed.http.tailscale,
    },
    watch: {
      roots: parsed.watch.roots.map((root) => resolveAgainst(configDir, root)),
      browserDropFolder: resolveAgainst(configDir, parsed.watch.browserDropFolder),
      settleMinutes: Number(process.env.VOICE_SETTLE_MINUTES) || parsed.watch.settleMinutes,
      browserSettleMs:
        process.env.VOICE_BROWSER_SETTLE_MS !== undefined
          ? Number(process.env.VOICE_BROWSER_SETTLE_MS)
          : parsed.watch.browserSettleMs,
      recursiveYears: parsed.watch.recursiveYears,
      createMissingRoots: parsed.watch.createMissingRoots,
    },
    whisper: {
      python: process.env.WHISPER_PYTHON?.trim() || parsed.whisper.python,
      model: process.env.WHISPER_MODEL?.trim() || parsed.whisper.model,
      device: process.env.WHISPER_DEVICE?.trim() || parsed.whisper.device,
      computeType: process.env.WHISPER_COMPUTE_TYPE?.trim() || parsed.whisper.computeType,
      promptTerms: parsed.whisper.promptTerms.map((term) => String(term).trim()).filter(Boolean),
    },
    audio: {
      preprocess: parsed.audio.preprocess,
    },
    queues: parsed.queues,
    ollanet: {
      machine: process.env.OLLANET_MACHINE?.trim() || parsed.ollanet.machine,
      cleanModel: process.env.OLLANET_CLEAN_MODEL?.trim() || parsed.ollanet.cleanModel,
      saveChats: parsed.ollanet.saveChats,
      required: parsed.ollanet.required,
    },
    journal: {
      index: resolveAgainst(configDir, parsed.journal.index),
      search: parsed.journal.search,
      embedModel: process.env.DICTA_EMBED_MODEL?.trim() || parsed.journal.embedModel,
      embedHost: process.env.DICTA_EMBED_HOST?.trim() || parsed.journal.embedHost.trim() || 'local',
    },
  };

  applyConfigToEnv(config);
  return config;
}

export const configPath = resolveConfigPath();
export const config = loadConfig(configPath);
