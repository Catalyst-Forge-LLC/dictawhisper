#!/usr/bin/env python3
"""Transcribe audio with faster-whisper; write OpenAI-Whisper-compatible JSON.

One-shot:
  python transcribe_faster_whisper.py --audio FILE --output FILE.json ...

Persistent worker (model loaded once; stdin/stdout JSON lines):
  python transcribe_faster_whisper.py --worker --model large-v3 --device cuda ...
  stdin:  {"id":"1","cmd":"transcribe","audio":"...","output":"...","initial_prompt":"..."}
          {"id":"2","cmd":"shutdown"}
  stdout: {"type":"ready","model":"...","device":"..."}
          {"id":"1","type":"progress","pct":12.3,"start":0,"end":4.2,"text":"..."}
          {"id":"1","type":"done","ok":true,"elapsed":18.4,"chars":123,"segments":10}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable

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

KEEP_KEYS = (
    "cleanedTranscription",
    "tags",
    "thinking",
    "meta",
    "elapsed",
    "cleanupError",
    "cleanupAttempts",
)


def _reconfigure_stdio() -> None:
    """Windows cp1252 cannot print Whisper tokens like ⁄ or ş; do not fail the job for a log line."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if not reconfigure:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


_reconfigure_stdio()


def resolve_model(name: str) -> str:
    key = name.strip().lower()
    if key not in MODEL_ALIASES:
        supported = ", ".join(sorted(MODEL_ALIASES))
        raise SystemExit(f"Unsupported model '{name}'. Use one of: {supported}")
    return MODEL_ALIASES[key]


def _write_line(msg: str, stream) -> None:
    try:
        print(msg, file=stream, flush=True)
    except UnicodeEncodeError:
        encoding = getattr(stream, "encoding", None) or "utf-8"
        payload = (msg + "\n").encode(encoding, errors="replace")
        buf = getattr(stream, "buffer", None)
        if buf is not None:
            buf.write(payload)
            buf.flush()
            return
        print(payload.decode(encoding, errors="replace"), file=stream, flush=True)


def log(msg: str) -> None:
    """Print immediately — piped stdout is block-buffered unless flushed."""
    _write_line(msg, sys.stdout)


def log_err(msg: str) -> None:
    _write_line(msg, sys.stderr)


def emit(payload: dict[str, Any]) -> None:
    _write_line(json.dumps(payload, ensure_ascii=False), sys.stdout)


def load_existing(output_path: Path) -> dict[str, Any]:
    if not output_path.is_file():
        return {}
    try:
        loaded = json.loads(output_path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def write_sidecar(
    output_path: Path,
    *,
    texts: list[str],
    segments: list[dict[str, Any]],
    language: str,
    model_name: str,
    device: str,
    compute_type: str,
    duration: float | None,
    vad_filter: bool,
) -> dict[str, Any]:
    existing = load_existing(output_path)
    payload = {key: existing[key] for key in KEEP_KEYS if key in existing}
    payload.update(
        {
            "text": "".join(texts).strip(),
            "segments": segments,
            "language": language,
            "whisper": {
                "engine": "faster-whisper",
                "model": model_name,
                "device": device,
                "compute_type": compute_type,
                "duration": duration,
                "vad_filter": vad_filter,
                "word_timestamps": True,
            },
        }
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return payload


def transcribe_to_sidecar(
    model: WhisperModel,
    audio_path: Path,
    output_path: Path,
    *,
    language: str,
    initial_prompt: str | None,
    vad_filter: bool,
    model_name: str,
    device: str,
    compute_type: str,
    log_fn: Callable[[str], None],
    progress_fn: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    if not audio_path.is_file():
        raise FileNotFoundError(f"audio not found: {audio_path}")

    log_fn(f"[transcribe] audio={audio_path}")
    log_fn("[transcribe] starting transcription...")

    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        task="transcribe",
        beam_size=5,
        vad_filter=vad_filter,
        initial_prompt=initial_prompt or None,
        condition_on_previous_text=False,
        compression_ratio_threshold=2.2,
        word_timestamps=True,
        log_progress=False,
    )

    duration = float(info.duration or 0.0)
    if duration > 0:
        log_fn(f"[transcribe] audio duration={duration:.1f}s language={info.language}")
    else:
        log_fn(f"[transcribe] language={info.language}")

    segments: list[dict[str, Any]] = []
    texts: list[str] = []
    for i, segment in enumerate(segments_iter):
        text = segment.text
        texts.append(text)
        words = []
        for word in segment.words or []:
            if word.start is None or word.end is None:
                continue
            words.append(
                {
                    "word": word.word,
                    "start": float(word.start),
                    "end": float(word.end),
                    "probability": float(word.probability) if word.probability is not None else None,
                }
            )
        segments.append(
            {
                "id": i,
                "seek": 0,
                "start": segment.start,
                "end": segment.end,
                "text": text,
                "words": words,
                "tokens": [],
                "temperature": segment.temperature,
                "avg_logprob": segment.avg_logprob,
                "compression_ratio": segment.compression_ratio,
                "no_speech_prob": segment.no_speech_prob,
            }
        )
        if duration > 0:
            pct = min(100.0, (segment.end / duration) * 100.0)
            log_fn(
                f"[transcribe] {pct:5.1f}% "
                f"({segment.start:7.1f}-{segment.end:7.1f}s / {duration:.1f}s) "
                f"{text.strip()}"
            )
            if progress_fn:
                progress_fn(
                    {
                        "pct": round(pct, 1),
                        "start": float(segment.start),
                        "end": float(segment.end),
                        "text": text.strip(),
                    }
                )
        else:
            log_fn(f"[{segment.start:7.2f} -> {segment.end:7.2f}] {text.strip()}")
            if progress_fn:
                progress_fn(
                    {
                        "pct": None,
                        "start": float(segment.start),
                        "end": float(segment.end),
                        "text": text.strip(),
                    }
                )

    if duration > 0:
        log_fn(f"[transcribe] 100.0% done ({duration:.1f}s)")

    payload = write_sidecar(
        output_path,
        texts=texts,
        segments=segments,
        language=info.language,
        model_name=model_name,
        device=device,
        compute_type=compute_type,
        duration=info.duration,
        vad_filter=vad_filter,
    )
    log_fn(f"[transcribe] wrote {output_path} ({len(payload['text'])} chars, {len(segments)} segments)")
    return {"chars": len(payload["text"]), "segments": len(segments), "duration": duration}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true", help="Long-lived stdin/stdout JSON worker")
    parser.add_argument("--audio", help="Path to audio file (one-shot)")
    parser.add_argument("--output", help="Path to output .json file (one-shot)")
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
    return parser


def run_oneshot(args: argparse.Namespace) -> int:
    if not args.audio or not args.output:
        print("[transcribe] --audio and --output are required in one-shot mode", file=sys.stderr, flush=True)
        return 1

    audio_path = Path(args.audio)
    output_path = Path(args.output)
    model_name = resolve_model(args.model)
    log(f"[transcribe] model={model_name} device={args.device} compute_type={args.compute_type}")
    log("[transcribe] loading model...")
    model = WhisperModel(model_name, device=args.device, compute_type=args.compute_type)
    log("[transcribe] model loaded; starting transcription...")
    transcribe_to_sidecar(
        model,
        audio_path,
        output_path,
        language=args.language,
        initial_prompt=args.initial_prompt,
        vad_filter=args.vad_filter,
        model_name=model_name,
        device=args.device,
        compute_type=args.compute_type,
        log_fn=log,
    )
    # CTranslate2/CUDA often abort() during teardown on Windows (exit 0xC0000409)
    # after a successful run. Skip destructors so Node sees a clean 0.
    os._exit(0)


def run_worker(args: argparse.Namespace) -> None:
    model_name = resolve_model(args.model)
    log_err(f"[transcribe] worker model={model_name} device={args.device} compute_type={args.compute_type}")
    log_err("[transcribe] loading model...")
    model = WhisperModel(model_name, device=args.device, compute_type=args.compute_type)
    log_err("[transcribe] model loaded")
    emit({"type": "ready", "model": model_name, "device": args.device, "compute_type": args.compute_type})

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except json.JSONDecodeError as error:
            emit({"type": "error", "error": f"invalid json: {error}"})
            continue

        job_id = str(job.get("id") or "")
        cmd = str(job.get("cmd") or "transcribe")
        if cmd == "shutdown":
            log_err("[transcribe] worker shutdown")
            # Same Windows CUDA teardown: skip destructors on the way out.
            os._exit(0)

        if cmd != "transcribe":
            emit({"id": job_id, "type": "done", "ok": False, "error": f"unknown cmd {cmd}"})
            continue

        job_model = resolve_model(str(job.get("model") or args.model))
        job_device = str(job.get("device") or args.device)
        job_compute = str(job.get("compute_type") or args.compute_type)
        if job_model != model_name or job_device != args.device or job_compute != args.compute_type:
            emit(
                {
                    "id": job_id,
                    "type": "done",
                    "ok": False,
                    "error": (
                        f"worker mismatch (loaded {model_name}/{args.device}/{args.compute_type}, "
                        f"job {job_model}/{job_device}/{job_compute})"
                    ),
                }
            )
            continue

        audio = job.get("audio")
        output = job.get("output")
        if not audio or not output:
            emit({"id": job_id, "type": "done", "ok": False, "error": "audio and output are required"})
            continue

        started = time.time()
        try:
            result = transcribe_to_sidecar(
                model,
                Path(str(audio)),
                Path(str(output)),
                language=str(job.get("language") or args.language),
                initial_prompt=job.get("initial_prompt", args.initial_prompt),
                vad_filter=bool(job.get("vad_filter", args.vad_filter)),
                model_name=model_name,
                device=args.device,
                compute_type=args.compute_type,
                log_fn=log_err,
                progress_fn=lambda payload, _id=job_id: emit({"id": _id, "type": "progress", **payload}),
            )
            emit(
                {
                    "id": job_id,
                    "type": "done",
                    "ok": True,
                    "elapsed": round(time.time() - started, 2),
                    "chars": result["chars"],
                    "segments": result["segments"],
                }
            )
        except Exception as error:
            emit(
                {
                    "id": job_id,
                    "type": "done",
                    "ok": False,
                    "elapsed": round(time.time() - started, 2),
                    "error": str(error),
                }
            )

    log_err("[transcribe] worker stdin closed")
    os._exit(0)


def main() -> int:
    args = build_parser().parse_args()
    if args.worker:
        run_worker(args)
        return 0
    return run_oneshot(args)


if __name__ == "__main__":
    raise SystemExit(main())
