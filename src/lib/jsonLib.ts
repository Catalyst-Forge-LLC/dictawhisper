export async function parseJSON(rawJSON: unknown = '') {
  if (rawJSON && typeof rawJSON === 'object') {
    return rawJSON as Record<string, any>;
  }

  const rawJson = String(rawJSON ?? '')
    .replaceAll(`\n",`, `",`)
    .replace(/^\s*```[\w]*\s*\n?([\s\S]*?)\s*```/gm, '$1')
    .trim();

  try {
    return JSON.parse(rawJson);
  } catch (error: any) {
    const firstObject = extractFirstJsonObject(rawJson);
    if (firstObject && firstObject !== rawJson) {
      try {
        const parsed = JSON.parse(firstObject);
        console.warn('[parse-json] ignored trailing content after the first JSON object');
        return parsed;
      } catch {
        // fall through
      }
    }

    if (String(error.message).includes(`"Expected ',' or '}`) || String(error.message).includes('Unterminated')) {
      const lastBraceIndex = rawJson.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        return JSON.parse(rawJson.substring(0, lastBraceIndex + 1));
      }
    }

    throw new Error(`Error parsing JSON response: ${error.message}`);
  }
}

/** First balanced `{...}`, ignoring braces inside strings. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}
