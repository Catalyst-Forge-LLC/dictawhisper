"""
Offline Parakeet pass that writes a Whisper-shaped sidecar (text + timed segments/words).

Uses nvidia/parakeet-unified-en-0.6b by default. Does not touch the live journal
unless --output points at a sidecar next to the audio.

  python scripts/transcribe_parakeet.py --audio FILE --output FILE.json
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any


DEFAULT_MODEL = "nvidia/parakeet-unified-en-0.6b"


def _stamp_seconds(stamp: dict[str, Any]) -> tuple[float, float]:
    start = stamp.get("start")
    end = stamp.get("end")
    if start is not None and end is not None:
        return float(start), float(end)
    raise KeyError("timestamp missing start/end seconds")


def _word_text(stamp: dict[str, Any]) -> str:
    return str(stamp.get("word") or stamp.get("char") or "").strip()


def hypotheses_to_sidecar(
    text: str,
    timestamp: dict[str, Any] | None,
    *,
    model_name: str,
    elapsed: float,
) -> dict[str, Any]:
    words_raw = list((timestamp or {}).get("word") or [])
    segs_raw = list((timestamp or {}).get("segment") or [])
    words: list[dict[str, Any]] = []
    for stamp in words_raw:
        token = _word_text(stamp)
        if not token:
            continue
        try:
            start, end = _stamp_seconds(stamp)
        except KeyError:
            continue
        words.append({"word": token, "start": start, "end": end})

    segments: list[dict[str, Any]] = []
    if segs_raw:
        for i, stamp in enumerate(segs_raw):
            body = str(stamp.get("segment") or stamp.get("text") or "").strip()
            try:
                start, end = _stamp_seconds(stamp)
            except KeyError:
                continue
            owned = [w for w in words if w["start"] >= start - 0.02 and w["end"] <= end + 0.02]
            segments.append(
                {
                    "id": i,
                    "start": start,
                    "end": end,
                    "text": body or " ".join(w["word"] for w in owned),
                    "words": owned,
                }
            )
    elif words:
        segments.append(
            {
                "id": 0,
                "start": words[0]["start"],
                "end": words[-1]["end"],
                "text": text,
                "words": words,
            }
        )

    return {
        "text": text.strip(),
        "segments": segments,
        "language": "en",
        "whisper": {
            "engine": "nemo-parakeet",
            "model": model_name,
            "word_timestamps": bool(words),
            "elapsed": elapsed,
        },
    }


def transcribe(audio: Path, model_name: str) -> dict[str, Any]:
    import nemo.collections.asr as nemo_asr  # type: ignore

    model = nemo_asr.models.ASRModel.from_pretrained(model_name=model_name)
    started = time.time()
    try:
        output = model.transcribe([str(audio)], timestamps=True)
    except TypeError:
        output = model.transcribe([str(audio)])
    elapsed = time.time() - started
    hyp = output[0]
    if isinstance(hyp, (list, tuple)):
        hyp = hyp[0]
    text = str(getattr(hyp, "text", hyp) or "")
    timestamp = getattr(hyp, "timestamp", None)
    if timestamp is None:
        timestamp = getattr(hyp, "timestep", None)
    if not isinstance(timestamp, dict):
        timestamp = {}
    return hypotheses_to_sidecar(text, timestamp, model_name=model_name, elapsed=elapsed)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()
    audio = args.audio.resolve()
    if not audio.is_file():
        raise SystemExit(f"audio not found: {audio}")
    payload = transcribe(audio, args.model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    words = sum(len(seg.get("words") or []) for seg in payload["segments"])
    print(
        f"[parakeet] wrote {args.output} chars={len(payload['text'])} "
        f"segments={len(payload['segments'])} words={words} elapsed={payload['whisper']['elapsed']:.1f}s"
    )
    if not words:
        print("[parakeet] no word timestamps — playback cues cannot be built from this pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
