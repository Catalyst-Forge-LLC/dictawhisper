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
      ...result.ollama,
    },
  };
}
