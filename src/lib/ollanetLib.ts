import { runPrompt } from 'ollanet';
import { config } from '../config.ts';
import { parseJSON } from './jsonLib.ts';

const DEFAULT_RETRIES = 3;
const BACKOFF_MS = [2_000, 8_000, 20_000];

export async function cleanWithOllanet(
  prompt: string,
  format: Record<string, unknown>
): Promise<{ completion: any; thinking: string | null; meta: Record<string, unknown> }> {
  if (!process.env.OLLAMA_PROMPT_TIMEOUT_MS) {
    process.env.OLLAMA_PROMPT_TIMEOUT_MS = '900000';
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= DEFAULT_RETRIES; attempt += 1) {
    try {
      return await runCleanOnce(prompt, format);
    } catch (error) {
      lastError = error;
      if (!isTransientCleanError(error) || attempt === DEFAULT_RETRIES) break;
      const waitMs = BACKOFF_MS[attempt - 1] ?? 20_000;
      console.warn(
        `[ollanet] ${describeCleanError(error)}; retry ${attempt}/${DEFAULT_RETRIES} in ${waitMs / 1000}s`
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
}

async function runCleanOnce(
  prompt: string,
  format: Record<string, unknown>
): Promise<{ completion: any; thinking: string | null; meta: Record<string, unknown> }> {
  const result = await runPrompt({
    machine: config.ollanet.machine,
    model: config.ollanet.cleanModel,
    prompt,
    save: config.ollanet.saveChats,
    writeStdout: false,
    quiet: true,
    // Stream so HTTP headers arrive immediately. Non-stream waits until the
    // full 27b reply is done, which trips undici's headers timeout.
    stream: true,
    settings: {
      format,
      think: false,
    },
  });

  let completion: any = result.content;
  try {
    completion = await parseJSON(completion);
  } catch {
    // leave as string; caller checks cleanedTranscription
  }

  return {
    completion,
    thinking: result.thinking,
    meta: {
      machine: result.machine,
      model: result.model,
      ...slimOllamaMeta(result.ollama),
    },
  };
}

export function isTransientCleanError(error: unknown): boolean {
  const code = errorCauseCode(error);
  if (
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return true;
  }
  const msg = error instanceof Error ? `${error.message} ${String((error as Error & { cause?: unknown }).cause ?? '')}` : String(error);
  return /headers timeout|fetch failed|timed out|socket hang up|ECONNRESET/i.test(msg);
}

export function describeCleanError(error: unknown): string {
  const code = errorCauseCode(error);
  if (code === 'UND_ERR_HEADERS_TIMEOUT') {
    return 'remote host did not send headers in time (model still loading or a long non-stream reply)';
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCauseCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const withCause = error as { code?: string; cause?: { code?: string } };
  return withCause.cause?.code || withCause.code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Keep timing/token stats; drop the response body (already stored as cleanedTranscription). */
export const OLLAMA_BODY_KEYS = new Set(['message', 'messages', 'response', 'content', 'thinking']);

export function slimOllamaMeta(ollama: unknown): Record<string, unknown> {
  if (!ollama || typeof ollama !== 'object' || Array.isArray(ollama)) return {};
  const slim: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ollama as Record<string, unknown>)) {
    if (OLLAMA_BODY_KEYS.has(key)) continue;
    slim[key] = value;
  }
  return slim;
}
