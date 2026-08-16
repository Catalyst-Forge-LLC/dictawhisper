import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = path.resolve(__dirname, '../config.json');

export type DictaConfig = {
  http: { port: number; corsOrigins: string[] };
  watch: {
    roots: string[];
    browserDropFolder: string;
    settleMinutes: number;
    recursiveYears: boolean;
  };
  whisper: {
    python: string;
    model: string;
    device: string;
    computeType: string;
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
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<DictaConfig>;
}

export function loadConfig(configPath: string = process.env.DICTA_CONFIG?.trim() || defaultConfigPath): DictaConfig {
  const file = readJson(configPath);
  const config: DictaConfig = {
    http: {
      port: Number(process.env.PORT) || file.http?.port || 8008,
      corsOrigins: file.http?.corsOrigins ?? ['http://localhost:5173'],
    },
    watch: {
      roots: file.watch?.roots ?? [],
      browserDropFolder: file.watch?.browserDropFolder ?? './data/audio-files',
      settleMinutes: Number(process.env.VOICE_SETTLE_MINUTES) || file.watch?.settleMinutes || 30,
      recursiveYears: file.watch?.recursiveYears ?? true,
    },
    whisper: {
      python:
        process.env.WHISPER_PYTHON?.trim() ||
        file.whisper?.python ||
        'python',
      model: process.env.WHISPER_MODEL?.trim() || file.whisper?.model || 'large-v3',
      device: process.env.WHISPER_DEVICE?.trim() || file.whisper?.device || 'cuda',
      computeType: process.env.WHISPER_COMPUTE_TYPE?.trim() || file.whisper?.computeType || 'float16',
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
      machine: process.env.OLLANET_MACHINE?.trim() || file.ollanet?.machine || 'YOUR-OLLANET-HOST',
      cleanModel: process.env.OLLANET_CLEAN_MODEL?.trim() || file.ollanet?.cleanModel || 'YOUR-CLEAN-MODEL',
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

export const config = loadConfig();
