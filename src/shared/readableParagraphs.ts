const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const MAX_SENTENCES = 6;

function sentencesIn(paragraph: string): string[] {
  const sentences: string[] = [];
  for (const { segment } of sentenceSegmenter.segment(paragraph)) {
    const previous = sentences.at(-1) || '';
    // ICU can separate a title/initial from its name, or a quotation from its
    // attribution. Keep those together when choosing a paragraph boundary.
    const titleOrInitial = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Rev|St|Mt|vs|e\.g|i\.e)\.|(?:^|\s)[A-Z]\.)\s*$/i.test(previous);
    const attribution = /["”’]\s*$/.test(previous) && /^\s*[a-z]/.test(segment);
    if (previous && (titleOrInitial || attribution)) sentences[sentences.length - 1] += segment;
    else sentences.push(segment);
  }
  return sentences;
}

/** Keep topic breaks, but divide oversized paragraphs without rewriting words. */
export function readableParagraphs(text: string): string[] {
  const paragraphs = String(text || '').trim().split(/\r?\n\s*\r?\n/).map(part => part.trim()).filter(Boolean);
  return paragraphs.flatMap(paragraph => {
    const sentences = sentencesIn(paragraph);
    if (sentences.length <= MAX_SENTENCES) return [paragraph];
    const sections: string[] = [];
    // Balance the groups so seven sentences do not become six plus one orphan.
    let remainingGroups = Math.ceil(sentences.length / MAX_SENTENCES), start = 0;
    while (remainingGroups > 0) {
      const size = Math.ceil((sentences.length - start) / remainingGroups);
      sections.push(sentences.slice(start, start + size).join('').trim());
      start += size; remainingGroups -= 1;
    }
    return sections;
  });
}
