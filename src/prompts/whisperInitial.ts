const BASE_INITIAL_PROMPT =
  'This is a personal audio journal spoken in English. ' +
  'Transcribe the speech accurately with natural punctuation and capitalization. ' +
  'Keep filler words, false starts, and repetitions as spoken. ' +
  'Do not paraphrase. Prefer unusual names and terms over common words that sound similar.';

export function buildWhisperInitialPrompt(promptTerms: string[] = []): string {
  const terms = promptTerms.map((term) => String(term || '').trim()).filter(Boolean);
  if (!terms.length) return BASE_INITIAL_PROMPT;
  return `${BASE_INITIAL_PROMPT} Names and terms that may appear: ${terms.join(', ')}.`;
}
