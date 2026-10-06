import path from 'node:path';
const locked = new Set<string>();
const key = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
export const entryOperationPending = (file: string) => locked.has(key(file));
export function assertEntryWritable(file: string) {
  if (entryOperationPending(file)) throw new Error('This entry is being moved or restored. Wait for the acknowledged result before changing it.');
}
export async function withEntryOperation<T>(files: string[], run: () => Promise<T>): Promise<T> {
  const keys = [...new Set(files.map(key))];
  for (const file of files) assertEntryWritable(file);
  keys.forEach(value => locked.add(value));
  try { return await run(); } finally { keys.forEach(value => locked.delete(value)); }
}
