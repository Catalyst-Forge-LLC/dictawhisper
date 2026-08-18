import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLEANUP_HISTORY_CAP,
  applyCleanupProvenance,
  currentCleanupRecord,
} from '../src/lib/cleanupProvenanceLib.ts';
import type { TranscriptionDocument } from '../src/types/transcription.ts';

test('first cleanup writes provenance and leaves history empty', () => {
  const json: TranscriptionDocument = { text: 'um hello' };
  applyCleanupProvenance(json, {
    text: 'Hello.',
    createdAt: '2026-08-18T12:00:00.000Z',
    model: 'qwen3:8b',
    host: 'macbook',
    promptVersion: 1,
    dictawhisperVersion: '0.0.0',
  });
  assert.equal(json.cleanedTranscription, 'Hello.');
  assert.equal(json.promptVersion, 1);
  assert.deepEqual(json.cleanup, {
    text: 'Hello.',
    createdAt: '2026-08-18T12:00:00.000Z',
    promptVersion: 1,
    dictawhisperVersion: '0.0.0',
    model: 'qwen3:8b',
    host: 'macbook',
  });
  assert.equal(json.cleanupHistory, undefined);
});

test('reclean archives the previous cleanup', () => {
  const json: TranscriptionDocument = { text: 'um hello' };
  applyCleanupProvenance(json, {
    text: 'Hello.',
    createdAt: '2026-01-01T00:00:00.000Z',
    model: 'old-model',
    host: 'old-host',
    promptVersion: 1,
    dictawhisperVersion: '0.0.0',
  });
  applyCleanupProvenance(json, {
    text: 'Hello there.',
    createdAt: '2026-08-18T12:00:00.000Z',
    model: 'new-model',
    host: 'new-host',
    promptVersion: 2,
    dictawhisperVersion: '0.0.0',
  });
  assert.equal(json.cleanedTranscription, 'Hello there.');
  assert.equal(json.cleanup?.model, 'new-model');
  assert.equal(json.cleanupHistory?.length, 1);
  assert.equal(json.cleanupHistory?.[0].text, 'Hello.');
  assert.equal(json.cleanupHistory?.[0].model, 'old-model');
});

test('legacy cleaned text becomes a history stub on reclean', () => {
  const json: TranscriptionDocument = {
    cleanedTranscription: 'Old cleaned.',
    promptVersion: 1,
    meta: { model: 'legacy', machine: 'box' },
  };
  const stub = currentCleanupRecord(json);
  assert.equal(stub?.text, 'Old cleaned.');
  assert.equal(stub?.model, 'legacy');
  assert.equal(stub?.host, 'box');
  applyCleanupProvenance(json, {
    text: 'New cleaned.',
    createdAt: '2026-08-18T12:00:00.000Z',
    model: 'now',
    host: 'here',
    promptVersion: 1,
    dictawhisperVersion: '0.0.0',
  });
  assert.equal(json.cleanupHistory?.[0].text, 'Old cleaned.');
  assert.equal(json.cleanupHistory?.[0].createdAt, undefined);
});

test('history is capped', () => {
  const json: TranscriptionDocument = {};
  for (let i = 0; i < CLEANUP_HISTORY_CAP + 5; i += 1) {
    applyCleanupProvenance(json, {
      text: `pass ${i}`,
      createdAt: `2026-01-01T00:00:00.00${i}Z`,
      promptVersion: 1,
      dictawhisperVersion: '0.0.0',
    });
  }
  assert.equal(json.cleanupHistory?.length, CLEANUP_HISTORY_CAP);
  assert.equal(json.cleanupHistory?.[0].text, `pass ${CLEANUP_HISTORY_CAP + 3}`);
});
