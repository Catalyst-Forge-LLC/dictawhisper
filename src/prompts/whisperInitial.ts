// Whisper treats this as preceding transcript context, not chat instructions.
// Instruction prose can be echoed as speech, especially with weak/noisy audio.
// Leave it empty unless the operator has supplied vocabulary hints.
export function buildWhisperInitialPrompt(promptTerms: string[] = []): string {
  const terms = promptTerms.map((term) => String(term || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(terms)].join(', ');
}
