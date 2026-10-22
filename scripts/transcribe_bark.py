"""Experimental Bark Pro transcription of one prepared WAV; never edits a live sidecar.

Uses the pinned local model, no remote code or network during inference. Timing
comes from the TDT decoder, never Whisper or evenly spaced text. Long recordings
are processed in contiguous windows cut at the lowest-energy nearby boundary.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time

MODEL = 'ConwayResearch/Underdog-Bark-3.0-Pro'
REVISION = '4b5c51e04aa8d16dda9ecdff71bc29f7360149e4'
PADDING = .25


def normalized(text):
    return ' '.join(text.split())


def timed_segments(text, tokens, offset, duration):
    """Validate token/text identity and model timing before exposing seek links."""
    if not tokens or normalized(''.join(str(t.get('token', '')) for t in tokens)) != normalized(text):
        raise ValueError('Timing tokens do not match the decoded text.')
    words = []
    previous = -1.0
    for token in tokens:
        value = token['token']
        start, end = float(token['start']) - PADDING, float(token['end']) - PADDING
        if not all(math.isfinite(x) for x in [start, end]) or start < -.5 or end < start or end > duration + .5 or start < previous - .08:
            raise ValueError('Model timestamps are outside the input window or out of order.')
        previous = start
        start, end = offset + max(0., min(duration, start)), offset + max(0., min(duration, end))
        if not value:
            continue
        if words and not value[0].isspace():
            words[-1]['word'] += value
            words[-1]['end'] = max(words[-1]['end'], end)
        else:
            words.append({'word': value, 'start': start, 'end': end})
    segments, group = [], []
    for word in words:
        group.append(word)
        if re.search(r'[.!?][\"\u201d\u2019\)]?$', word['word']) or len(group) >= 45:
            segments.append({'start': group[0]['start'], 'end': max(w['end'] for w in group), 'text': ''.join(w['word'] for w in group).strip(), 'words': group})
            group = []
    if group:
        segments.append({'start': group[0]['start'], 'end': max(w['end'] for w in group), 'text': ''.join(w['word'] for w in group).strip(), 'words': group})
    return segments


def cut_sample(wave, rate, maximum):
    """A contiguous cut, not VAD: quiet audio is still sent to the recognizer."""
    import numpy as np
    if len(wave) <= maximum:
        return len(wave)
    width = max(1, int(.12 * rate))
    first = max(width, int(maximum * .75))
    candidates = range(first, maximum - width + 1, width)
    return min(candidates, key=lambda i: float(np.mean(wave[i:i+width] ** 2))) + width // 2


def main():
    started = time.perf_counter()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--model-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'data/models/bark-pro')
    parser.add_argument('--device', choices=['cuda', 'cpu'], default='cuda')
    parser.add_argument('--chunk-seconds', type=int, default=60)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    import numpy as np
    import soundfile as sf
    import torch
    import transformers
    from transformers import AutoProcessor, ParakeetForTDT
    if args.check:
        print(json.dumps({'torch': torch.__version__, 'transformers': transformers.__version__, 'cuda': torch.cuda.is_available(),
                          'bf16': torch.cuda.is_available() and torch.cuda.is_bf16_supported(), 'modelReady': (args.model_dir / 'dictawhisper-model.json').is_file()}))
        return
    if not args.audio or not args.output:
        parser.error('--audio and --output are required')
    if args.audio.resolve() == args.output.resolve() or args.output.exists():
        parser.error('Output must be a new file separate from the audio and live sidecar.')
    if not 10 <= args.chunk_seconds <= 120:
        parser.error('--chunk-seconds must be between 10 and 120')
    manifest = json.loads((args.model_dir / 'dictawhisper-model.json').read_text(encoding='utf8'))
    if manifest != {'model': MODEL, 'revision': REVISION}:
        parser.error('Model revision does not match this adapter; rerun setup.')
    if args.device == 'cuda' and (not torch.cuda.is_available() or not torch.cuda.is_bf16_supported()):
        parser.error('CUDA with BF16 is unavailable. Check the NVIDIA driver; CPU must be requested explicitly.')
    with sf.SoundFile(args.audio) as source:
        if source.samplerate != 16000 or not len(source):
            parser.error('Prepare a nonempty 16 kHz WAV with FFmpeg first.')
    before_load = time.perf_counter()
    dtype = torch.bfloat16 if args.device == 'cuda' else torch.float32
    processor = AutoProcessor.from_pretrained(args.model_dir, local_files_only=True, trust_remote_code=False)
    model = ParakeetForTDT.from_pretrained(args.model_dir, dtype=dtype, local_files_only=True, trust_remote_code=False).to(args.device).eval()
    load_seconds = time.perf_counter() - before_load
    segments, windows, warnings, texts = [], [], [], []
    inference_seconds = 0.
    with sf.SoundFile(args.audio) as source:
        rate, total = source.samplerate, len(source)
        maximum = args.chunk_seconds * rate
        start = 0
        while start < total:
            source.seek(start)
            wave = source.read(min(maximum + 1, total - start), dtype='float32', always_2d=True).mean(axis=1)
            count = cut_sample(wave, rate, maximum)
            wave = wave[:count]
            duration = count / rate
            print(f'[bark] Audio {start/rate:.1f}–{(start+count)/rate:.1f}s of {total/rate:.1f}s', file=sys.stderr, flush=True)
            padded = np.concatenate([np.zeros(int(PADDING * rate), np.float32), wave])
            inputs = processor(padded, sampling_rate=rate, return_tensors='pt').to(args.device, dtype)
            before = time.perf_counter()
            with torch.inference_mode():
                output = model.generate(**inputs, return_dict_in_generate=True)
            if args.device == 'cuda':
                torch.cuda.synchronize()
            inference_seconds += time.perf_counter() - before
            ids = output.sequences
            text = processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
            texts.append(text)
            windows.append({'start': start / rate, 'end': (start + count) / rate, 'text': text})
            if text:
                try:
                    if getattr(output, 'durations', None) is None:
                        raise ValueError('The runtime did not return model timing.')
                    _, times = processor.decode(ids, durations=output.durations, skip_special_tokens=True)
                    segments.extend(timed_segments(text, times[0], start / rate, duration))
                except (ValueError, TypeError, AttributeError, IndexError, KeyError) as error:
                    warnings.append(f'{start/rate:.1f}s: {error}')
            start += count
            del inputs, output
    # Never publish a partly timed transcript as though timing covered all text.
    if warnings:
        segments = []
    for i, segment in enumerate(segments):
        segment['id'] = i
    elapsed = time.perf_counter() - started
    text = '\n\n'.join(t for t in texts if t)
    if not text:
        raise ValueError('Bark returned no speech. Saved transcript is unchanged.')
    digest = hashlib.sha256()
    with args.audio.open('rb') as audio:
        for block in iter(lambda: audio.read(1024 * 1024), b''):
            digest.update(block)
    payload = {'text': text, 'segments': segments, 'language': 'en', 'elapsed': f'{elapsed:.3f}s',
               'asrExperiment': {'engine': 'bark-pro', 'model': MODEL, 'revision': REVISION, 'comparisonOnly': True,
                                 'device': args.device, 'dtype': str(dtype), 'runtime': f'transformers {transformers.__version__}',
                                 'timing': 'model-token-estimates' if segments else 'unavailable', 'warnings': warnings,
                                 'chunkSeconds': args.chunk_seconds, 'windows': windows, 'audioSha256': digest.hexdigest(),
                                 'durationSec': total / rate, 'loadSeconds': load_seconds, 'inferenceSeconds': inference_seconds,
                                 'totalSeconds': elapsed}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf8') as output_file:
        json.dump(payload, output_file, ensure_ascii=False, indent=2, allow_nan=False)
    print(f'[bark] Finished: {len(segments)} timed passages; {elapsed:.1f}s total.', file=sys.stderr)


if __name__ == '__main__':
    main()
