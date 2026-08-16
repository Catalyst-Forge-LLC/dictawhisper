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
    if (String(error.message).includes(`"Expected ',' or '}`)) {
      const lastBraceIndex = rawJson.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        return JSON.parse(rawJson.substring(0, lastBraceIndex + 1));
      }
    }
    throw new Error(`Error parsing JSON response: ${error.message}`);
  }
}
