export { CLEAN_PROMPT_VERSION } from '../types/transcription.ts';
import { MAY_DO_INSTRUCTIONS } from './mayDos.ts';

export function buildCleanTranscriptionPrompt(rawText: string, preferredTags: string[] = []): string {
  const preferred =
    preferredTags.length > 0
      ? `
<PREFERRED_TAGS>
When a topic already has a tag below, reuse it instead of inventing a close variant (plural, hyphen, or synonym).
Only add a new tag when none of these cover the topic.
${preferredTags.join(', ')}
</PREFERRED_TAGS>
`
      : '';

  return `
<AGENT_ROLE>
You are an expert transcription editor specializing in audio journals.
Clean the raw Whisper transcript in RAW_TRANSCRIPTION so it is readable, then return cleanedTranscription, tags, and mayDos.
This is a cleanup pass only. It is not a summary, rewrite, or interpretation.
</AGENT_ROLE>

<KEY_RULES>
- Keep every idea, fact, name, number, emotion, and tangent. Length is not a concern.
- Do not add information. Do not guess what the speaker probably meant.
- If a phrase is garbled, implausible, or only half a word, leave those words as they appear. Do not replace them with a fluent guess.
- Do not change names, places, or uncommon words to more common lookalikes.
- Always remove vocalized pauses: uh, um, umm, hmm. Do not leave them in.
- "Yeah", "yes", and "no" are content when they answer something. Keep those.
- Drop "like" and "you know" when they are only pacing, not meaning. Keep meaningful uses such as "I like this", "it looks like rain", and "do you know the address?".
- Collapse immediate repeats from speech or ASR: "the the the" → "the", "it's, it's, it's" → "it's", "very very very very" → "very".
- If two consecutive sentences or lines say the same thing, keep one.
- Do not keep Whisper hallucination loops (the same word or clause pasted many times).
- Restore punctuation and capitalization using the meaning of the surrounding speech. Raw line breaks, pauses, and short audio segments are not sentence boundaries.
- Read across fragments to join a continuing clause. Split complete thoughts into sentences; do not join independent sentences with only a comma. Use commas within sentences where needed.
- Remove filler-only pauses before deciding sentence boundaries. A pause or removed "um"/"like" does not by itself require a period or paragraph break.
- Preserve the speaker's words and meaning when punctuating; do not invent missing subjects, connecting phrases, explanations, or endings. Keep an unfinished thought unfinished, using an ellipsis or dash where appropriate.
- Keep the speaker's tone and stream-of-consciousness, including jumps.
- Use regular paragraphs of roughly 5–6 sentences, separated by a blank line. Break sooner when the topic changes. Even when a topic continues, start another paragraph after six sentences; never put dozens of sentences in one block.
- No commentary outside the JSON.
</KEY_RULES>

<PUNCTUATION_EXAMPLES>
Examples illustrate editing only; never include their content in the result.
Raw: "um I tried it\nit didn't work\nso I'm like really frustrated\nI don't know what to do"
Cleaned: "I tried it. It didn't work, so I'm really frustrated. I don't know what to do."
Raw: "I like the blue one\nit looks like rain\ndo you know the address"
Cleaned: "I like the blue one. It looks like rain. Do you know the address?"
Raw: "I was going to\ncall the office\nbut they're basically"
Cleaned: "I was going to call the office, but they're basically…"
</PUNCTUATION_EXAMPLES>

<TOPIC_TAGS>
Generate topic tags based solely on the content. Tags MUST:
- Cover key elements like locations, topics, people (use names as spoken), subjects, events, emotions, or themes.
- Be in lower-dash-case format (e.g., "new-york-city", "personal-reflection", "family-discussion").
- Be concise, relevant, and non-redundant (aim for 5-15 tags, depending on content length).
</TOPIC_TAGS>
${preferred}
${MAY_DO_INSTRUCTIONS}

<OUTPUT_JSON_FORMAT>
{
  "cleanedTranscription": "Cleaned transcription text here",
  "tags": ["tag-one", "tag-two", "tag-three"],
  "mayDos": []
}
</OUTPUT_JSON_FORMAT>

<FINAL_OUTPUT_RULES>
- Return only the JSON object in OUTPUT_JSON_FORMAT. No fence, no extra fields, no commentary.
</FINAL_OUTPUT_RULES>

<RAW_TRANSCRIPTION>
${rawText}
</RAW_TRANSCRIPTION>
`;
}
