import { runPrompt } from 'ollanet';
import { config } from '../config.ts';
import { parseJSON } from './jsonLib.ts';

export async function cleanWithOllanet(
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
    stream: false,
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
