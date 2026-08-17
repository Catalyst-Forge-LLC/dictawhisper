#!/usr/bin/env python3
"""Transcribe audio with faster-whisper; write OpenAI-Whisper-compatible JSON."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from faster_whisper import WhisperModel

MODEL_ALIASES = {
    "large": "large-v3",
    "large-v3": "large-v3",
    "turbo": "large-v3-turbo",
    "large-v3-turbo": "large-v3-turbo",
}

# Light journal context only — do not ask the model to rewrite/polish speech.
# Downstream LLM cleanup already removes fillers while preserving content.
DEFAULT_INITIAL_PROMPT = (
    "This is a personal audio journal spoken in English. "
    "Transcribe the speech accurately with natural punctuation and capitalization. "
    "Keep filler words, false starts, and repetitions as spoken. "
    "Do not paraphrase. Prefer unusual names and terms over common words that sound similar."
)


def resolve_model(name: str) -> str:
    key = name.strip().lower()
    if key not in MODEL_ALIASES:
        supported = ", ".join(sorted(MODEL_ALIASES))
        raise SystemExit(f"Unsupported model '{name}'. Use one of: {supported}")
    return MODEL_ALIASES[key]


def log(msg: str) -> None:
    """Print immediately — piped stdout is block-buffered unless flushed."""
    print(msg, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument("--output", required=True, help="Path to output .json file")
    parser.add_argument(
        "--model",
        default="large-v3",
        help="Model alias: large-v3|large|turbo|large-v3-turbo (default: large-v3)",
    )
    parser.add_argument("--device", default="cuda", choices=("cuda", "cpu"))
    parser.add_argument(
        "--compute-type",
        default="float16",
        help="CTranslate2 compute type (default: float16). Use int8_float16 if VRAM is tight.",
    )
    parser.add_argument("--language", default="en")
    parser.add_argument(
        "--initial-prompt",
        default=DEFAULT_INITIAL_PROMPT,
        help="Optional first-window prompt. Pass empty string to disable.",
    )
    parser.add_argument(
        "--vad-filter",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Silero VAD to skip silence (default: on)",
    )
    args = parser.parse_args()

    audio_path = Path(args.audio)
    output_path = Path(args.output)
    if not audio_path.is_file():
        print(f"[transcribe] audio not found: {audio_path}", file=sys.stderr, flush=True)
        return 1

    model_name = resolve_model(args.model)
    log(f"[transcribe] model={model_name} device={args.device} compute_type={args.compute_type}")
    log(f"[transcribe] audio={audio_path}")
    log("[transcribe] loading model...")

    model = WhisperModel(model_name, device=args.device, compute_type=args.compute_type)
    log("[transcribe] model loaded; starting transcription...")
    initial_prompt = args.initial_prompt or None

    segments_iter, info = model.transcribe(
        str(audio_path),
        language=args.language,
        task="transcribe",
        beam_size=5,
        vad_filter=args.vad_filter,
        initial_prompt=initial_prompt,
        condition_on_previous_text=True,
        log_progress=False,
    )

    duration = float(info.duration or 0.0)
    if duration > 0:
        log(f"[transcribe] audio duration={duration:.1f}s language={info.language}")
    else:
        log(f"[transcribe] language={info.language}")

    segments = []
    texts = []
    for i, segment in enumerate(segments_iter):
        text = segment.text
        texts.append(text)
        segments.append(
            {
                "id": i,
                "seek": 0,
                "start": segment.start,
                "end": segment.end,
                "text": text,
                "tokens": [],
                "temperature": segment.temperature,
                "avg_logprob": segment.avg_logprob,
                "compression_ratio": segment.compression_ratio,
                "no_speech_prob": segment.no_speech_prob,
            }
        )
        if duration > 0:
            pct = min(100.0, (segment.end / duration) * 100.0)
            log(
                f"[transcribe] {pct:5.1f}% "
                f"({segment.start:7.1f}-{segment.end:7.1f}s / {duration:.1f}s) "
                f"{text.strip()}"
            )
        else:
            log(f"[{segment.start:7.2f} -> {segment.end:7.2f}] {text.strip()}")

    if duration > 0:
        log(f"[transcribe] 100.0% done ({duration:.1f}s)")

    payload = {
        "text": "".join(texts).strip(),
        "segments": segments,
        "language": info.language,
        "whisper": {
            "engine": "faster-whisper",
            "model": model_name,
            "device": args.device,
            "compute_type": args.compute_type,
            "duration": info.duration,
            "vad_filter": args.vad_filter,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"[transcribe] wrote {output_path} ({len(payload['text'])} chars, {len(segments)} segments)")
    # CTranslate2/CUDA often abort() during teardown on Windows (exit 0xC0000409)
    # after a successful run. Skip destructors so Node sees a clean 0.
    os._exit(0)


if __name__ == "__main__":
    raise SystemExit(main())
