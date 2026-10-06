export const stageCopy = {
  waiting_for_file: 'Waiting for file to finish syncing', queued_transcription: 'Waiting to transcribe', transcribing: 'Transcribing',
  queued_cleanup: 'Transcript ready · Waiting to clean', cleaning: 'Cleaning transcript and extracting MayDos', ready: 'Ready',
  raw_only: 'Original transcript ready', failed_transcription: 'Could not transcribe audio', failed_cleanup: 'Transcript ready · Cleanup failed',
  extracting_maydos: 'Transcript ready · Extracting MayDos', failed_maydos: 'Transcript ready · MayDo extraction failed', interrupted: 'Processing interrupted',
};
export const working = item => ['waiting_for_file','queued_transcription','transcribing','queued_cleanup','cleaning','extracting_maydos'].includes(item.stage);
export const failure = item => item.stage.startsWith('failed_') || item.stage === 'interrupted';
export function mergeActivity(current, event) {
  if (event.epoch !== current.epoch || event.revision !== current.revision + 1) return null;
  const rows = new Map(current.items.map(item => [item.id, item])); rows.set(event.item.id, event.item);
  return { ...current, revision: event.revision, items: [...rows.values()].sort((a,b) => b.updatedAt-a.updatedAt) };
}
export const retryLabel = item => item.stage === 'failed_cleanup' ? 'Retry cleanup' : item.stage === 'failed_maydos' ? 'Retry MayDos' : item.stage === 'interrupted' ? item.resumeStage === 'extracting_maydos' ? 'Resume MayDos' : ['cleaning','queued_cleanup'].includes(item.resumeStage) ? 'Resume cleanup' : 'Resume transcription' : 'Retry transcription';
