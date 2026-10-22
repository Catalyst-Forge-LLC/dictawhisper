"""Fetch pinned Bark Pro data only. No model-supplied Python is downloaded/run."""
import argparse
import json
from pathlib import Path

MODEL = 'ConwayResearch/Underdog-Bark-3.0-Pro'
REVISION = '4b5c51e04aa8d16dda9ecdff71bc29f7360149e4'

def main():
    from huggingface_hub import snapshot_download
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', required=True, type=Path)
    args = parser.parse_args()
    snapshot_download(MODEL, revision=REVISION, local_dir=args.model_dir,
                      allow_patterns=['model.safetensors', 'config.json', 'generation_config.json',
                                      'processor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'NOTICE', 'README.md'])
    (args.model_dir / 'dictawhisper-model.json').write_text(
        json.dumps({'model': MODEL, 'revision': REVISION}, indent=2), encoding='utf8')
    print(f'Pinned model ready: {MODEL}@{REVISION}')

if __name__ == '__main__':
    main()
