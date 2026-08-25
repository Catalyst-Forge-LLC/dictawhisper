"""
Head-to-head: existing Whisper sidecar vs an optional Parakeet pass.

Does not overwrite the live journal. Writes data/asr-compare/<stem>/

  python scripts/compare_asr.py --audio "C:\\Users\\acmegeek\\VoiceNotes\\2013\\05\\2013-05-20_08-46-43.mp3"
  python scripts/compare_asr.py --audio FILE --parakeet   # needs a NeMo venv, not the Whisper one
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

KEEP_NAMES = ("kristen", "grace", "hope", "mindcorp", "vanta", "sangria")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def flatten_words(payload: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for seg in payload.get("segments") or []:
        for word in seg.get("words") or []:
            if word.get("start") is None or word.get("end") is None:
                continue
            token = str(word.get("word") or "").strip()
            if token:
                out.append(word)
    return out


def count_names(text: str) -> dict[str, int]:
    lower = text.lower()
    return {name: len(re.findall(rf"\b{re.escape(name)}\b", lower)) for name in KEEP_NAMES}


def summarize(label: str, payload: dict[str, Any]) -> dict[str, Any]:
    words = flatten_words(payload)
    text = str(payload.get("text") or "")
    engine = payload.get("whisper") or {}
    return {
        "label": label,
        "engine": engine.get("engine"),
        "model": engine.get("model"),
        "chars": len(text),
        "segments": len(payload.get("segments") or []),
        "words": len(words),
        "word_span": (words[0]["start"], words[-1]["end"]) if words else None,
        "names": count_names(text),
        "text_head": " ".join(text.split())[:360],
    }


def write_report(out_dir: Path, rows: list[dict[str, Any]]) -> None:
    lines = ["# ASR compare", ""]
    for row in rows:
        lines.append(f"## {row['label']}")
        lines.append("")
        lines.append(f"- engine: {row.get('engine')} / {row.get('model')}")
        lines.append(f"- chars: {row['chars']}")
        lines.append(f"- segments: {row['segments']}")
        lines.append(f"- words with times: {row['words']}")
        if row.get("word_span"):
            start, end = row["word_span"]
            lines.append(f"- word span: {start:.2f}s–{end:.2f}s")
        names = ", ".join(f"{k}={v}" for k, v in (row.get("names") or {}).items() if v)
        lines.append(f"- house names: {names or '(none)'}")
        lines.append("")
        lines.append(row.get("text_head") or "")
        lines.append("")
    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")
    (out_dir / "summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--sidecar", type=Path, help="Existing Whisper sidecar (default: audio .json)")
    parser.add_argument("--out", type=Path, help="Compare folder (default: data/asr-compare/<stem>)")
    parser.add_argument("--parakeet", action="store_true", help="Run Parakeet (needs nemo in this Python)")
    parser.add_argument("--parakeet-python", type=Path, help="Python with nemo_toolkit[asr] installed")
    parser.add_argument("--model", default="nvidia/parakeet-unified-en-0.6b")
    args = parser.parse_args()

    audio = args.audio.resolve()
    if not audio.is_file():
        # common: sidecar path passed instead of mp3
        sibling = audio.with_suffix(".mp3")
        if sibling.is_file():
            audio = sibling
        else:
            raise SystemExit(f"audio not found: {audio}")

    sidecar = (args.sidecar or audio.with_suffix(".json")).resolve()
    root = Path(__file__).resolve().parents[1]
    out_dir = (args.out or root / "data" / "asr-compare" / audio.stem).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict[str, Any]] = []
    if sidecar.is_file():
        dest = out_dir / "whisper.json"
        shutil.copy2(sidecar, dest)
        rows.append(summarize("whisper", load_json(dest)))
        print(f"[compare] reused sidecar {sidecar}")
    else:
        print(f"[compare] no Whisper sidecar at {sidecar}")

    if args.parakeet:
        py = str(args.parakeet_python or sys.executable)
        script = root / "scripts" / "transcribe_parakeet.py"
        dest = out_dir / "parakeet.json"
        cmd = [py, str(script), "--audio", str(audio), "--output", str(dest), "--model", args.model]
        print(f"[compare] {' '.join(cmd)}")
        proc = subprocess.run(cmd, check=False)
        if proc.returncode != 0:
            raise SystemExit(proc.returncode)
        rows.append(summarize("parakeet", load_json(dest)))
    else:
        print("[compare] skip Parakeet (pass --parakeet and a NeMo Python)")

    write_report(out_dir, rows)
    print(f"[compare] wrote {out_dir / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
