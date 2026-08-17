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
Clean the raw Whisper transcript in RAW_TRANSCRIPTION so it is readable, then return cleanedTranscription and tags.
This is a cleanup pass only. It is not a summary, rewrite, or interpretation.
</AGENT_ROLE>

<KEY_RULES>
- Keep every idea, fact, name, number, emotion, and tangent. Length is not a concern.
- Do not add information. Do not guess what the speaker probably meant.
- If a phrase is garbled, implausible, or only half a word, leave those words as they appear. Do not replace them with a fluent guess.
- Do not change names, places, or uncommon words to more common lookalikes.
- "Yeah", "yes", "no", and similar answers are content. Only drop true vocalized pauses (uh, um, umm, hmm) and empty repetitions or false starts.
- "Like" and "you know" may be fillers or real wording; remove them only when they clearly add no meaning.
- Fix punctuation, capitalization, and broken grammar from speech so it reads cleanly, keeping the original words.
- Keep the speaker's tone and stream-of-consciousness, including jumps.
- Use natural paragraph breaks. No commentary outside the JSON.
</KEY_RULES>

<TOPIC_TAGS>
Generate topic tags based solely on the content. Tags MUST:
- Cover key elements like locations, topics, people (use names as spoken), subjects, events, emotions, or themes.
- Be in lower-dash-case format (e.g., "new-york-city", "personal-reflection", "family-discussion").
- Be concise, relevant, and non-redundant (aim for 5-15 tags, depending on content length).
</TOPIC_TAGS>
${preferred}

<OUTPUT_JSON_FORMAT>
{
  "cleanedTranscription": "Cleaned transcription text here",
  "tags": ["tag-one", "tag-two", "tag-three"]
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
