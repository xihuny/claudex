#!/usr/bin/env bash
# Download the speech models voice typing needs. Safe to re-run; skips what's there.
#
# The Kroko model writes its own capitals and punctuation and is 68 MB. It is CC-BY-SA
# (credit: https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06).
# Downloads are pinned to one repository revision and verified against SHA-256 sums, so
# a changed or tampered file is rejected rather than loaded.
set -euo pipefail

SHERPA_DIR="${SHERPA_DIR:-$HOME/.local/opt/sherpa}"
mkdir -p "$SHERPA_DIR"

REPO="sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06"
REV="572aaf4e2e0c603c3fc2a574d096e755a178faa1"
# (a case, not an associative array: macOS ships bash 3.2)
expected() {
  case "$1" in
    encoder.onnx) echo d4881c57449d581e0770fd53fa66c2fdc6cd167d92ece7c715e603defc96d9d4 ;;
    decoder.onnx) echo 455ba38466fce8d5a57e7db68a323b684079ca4d9e1dd93a740d9b2429aae3b1 ;;
    joiner.onnx)  echo d406f616736350e2a7df3e39398b78eb2fc1a2ca6973a19d3853fa3227e25b52 ;;
    tokens.txt)   echo 396dbeb5f4858875690716084f54e90d339679d0ba3e6b5b584f3d7589254d2d ;;
  esac
}

sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

dir="$SHERPA_DIR/$REPO"
mkdir -p "$dir"
echo "kroko streaming recogniser (cased + punctuated, 68 MB) -> $dir"
for f in encoder.onnx decoder.onnx joiner.onnx tokens.txt; do
  want="$(expected "$f")"
  if [ -s "$dir/$f" ] && [ "$(sum "$dir/$f")" = "$want" ]; then echo "  have $f"; continue; fi
  echo "  get  $f"
  curl -fL --progress-bar -o "$dir/$f.part" "https://huggingface.co/csukuangfj/$REPO/resolve/$REV/$f"
  got="$(sum "$dir/$f.part")"
  if [ "$got" != "$want" ]; then rm -f "$dir/$f.part"; echo "  ✗ checksum mismatch for $f (got $got). Not installed."; exit 1; fi
  mv "$dir/$f.part" "$dir/$f"
done

echo
echo "done. models in $SHERPA_DIR:"
du -sh "$SHERPA_DIR"/*/ 2>/dev/null || true
echo
echo "Restart Claudex; the mic button appears in the composer once the models load."
