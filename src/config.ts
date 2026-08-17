import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const defaultConfigPath = path.resolve(__dirname, '../config.json');

export type DictaConfig = {
  http: {
    host: string;
    port: number;
    corsOrigins: string[];
    /** Bind API + UI on all interfaces and allow Tailscale MagicDNS / 100.x origins. */
    tailscale: boolean;
  };
  watch: {
    roots: string[];
    browserDropFolder: string;
    settleMinutes: number;
    browserSettleMs: number;
    recursiveYears: boolean;
    /** If true, missing watch roots are created as empty folders instead of failing doctor. */
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
  };
};

function readJson(filePath: string): Partial<DictaConfig> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw) as Partial<DictaConfig>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`config is not valid JSON (${filePath}): ${detail}`);
  }
}

function resolveExistingOrPlain(filePath: string): string {
  return path.resolve(filePath);
}

export function loadConfig(configPath: string = process.env.DICTA_CONFIG?.trim() || defaultConfigPath): DictaConfig {
  const file = readJson(configPath);
  const config: DictaConfig = {
    http: {
      host: process.env.HOST?.trim() || file.http?.host || '127.0.0.1',
      port: Number(process.env.PORT) || file.http?.port || 8008,
      corsOrigins: file.http?.corsOrigins ?? ['http://localhost:7777', 'http://127.0.0.1:7777'],
      tailscale:
        process.env.DICTA_TAILSCALE === '1' ||
        process.env.DICTA_TAILSCALE === 'true' ||
        file.http?.tailscale === true,
    },
    watch: {
      roots: (file.watch?.roots ?? []).map((root) => resolveExistingOrPlain(root)),
      browserDropFolder: resolveExistingOrPlain(file.watch?.browserDropFolder ?? './data/audio-files'),
      settleMinutes: Number(process.env.VOICE_SETTLE_MINUTES) || file.watch?.settleMinutes || 30,
      browserSettleMs:
        process.env.VOICE_BROWSER_SETTLE_MS !== undefined
          ? Number(process.env.VOICE_BROWSER_SETTLE_MS)
          : (file.watch?.browserSettleMs ?? 0),
      recursiveYears: file.watch?.recursiveYears ?? true,
      createMissingRoots: file.watch?.createMissingRoots ?? false,
    },
    whisper: {
      python: process.env.WHISPER_PYTHON?.trim() || file.whisper?.python || 'python',
      model: process.env.WHISPER_MODEL?.trim() || file.whisper?.model || 'large-v3',
      device: process.env.WHISPER_DEVICE?.trim() || file.whisper?.device || 'cuda',
      computeType: process.env.WHISPER_COMPUTE_TYPE?.trim() || file.whisper?.computeType || 'float16',
      promptTerms: Array.isArray(file.whisper?.promptTerms)
        ? file.whisper.promptTerms.map((term) => String(term).trim()).filter(Boolean)
        : [],
    },
    audio: {
      preprocess: file.audio?.preprocess ?? true,
    },
    queues: {
      transcription: {
        active: file.queues?.transcription?.active ?? true,
        concurrency: file.queues?.transcription?.concurrency ?? 1,
      },
      processing: {
        active: file.queues?.processing?.active ?? true,
        concurrency: file.queues?.processing?.concurrency ?? 1,
      },
    },
    ollanet: {
      machine: process.env.OLLANET_MACHINE?.trim() || file.ollanet?.machine || '',
      cleanModel: process.env.OLLANET_CLEAN_MODEL?.trim() || file.ollanet?.cleanModel || '',
      saveChats: file.ollanet?.saveChats ?? false,
    },
  };

  process.env.VOICE_SETTLE_MINUTES = String(config.watch.settleMinutes);
  process.env.WHISPER_MODEL = config.whisper.model;
  process.env.WHISPER_PYTHON = config.whisper.python;
  process.env.WHISPER_DEVICE = config.whisper.device;
  process.env.WHISPER_COMPUTE_TYPE = config.whisper.computeType;

  return config;
}

export const configPath = process.env.DICTA_CONFIG?.trim() || defaultConfigPath;
export const config = loadConfig(configPath);
