export const transcriptionModels = ['bark-pro', 'large-v3', 'turbo'] as const;
export type TranscriptionModel = typeof transcriptionModels[number];
export function isTranscriptionModel(model: unknown): model is TranscriptionModel {
  return transcriptionModels.includes(model as TranscriptionModel);
}
export function asrModelLabel(model: string) {
  return model === 'bark-pro' ? 'Bark Pro' : `Whisper ${model}`;
}
