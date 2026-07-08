#!/usr/bin/env bash
# One-time FaceFusion setup for the automated face-swap processor.
# Usage:  bash scripts/install_facefusion.sh [TARGET_DIR] [cuda|cpu]
# Then set the "faceFusion" connection's facefusionDir to TARGET_DIR in Settings.
set -euo pipefail

TARGET_DIR="${1:-$HOME/facefusion}"
ONNX="${2:-cuda}"   # 'cuda' for NVIDIA GPU, 'cpu' otherwise
REPO="https://github.com/facefusion/facefusion.git"

echo "==> FaceFusion install"
echo "    dir:        $TARGET_DIR"
echo "    onnxruntime: $ONNX"

if [ ! -d "$TARGET_DIR/.git" ]; then
  echo "==> Cloning $REPO"
  git clone --depth 1 "$REPO" "$TARGET_DIR"
else
  echo "==> Repo exists, pulling latest"
  git -C "$TARGET_DIR" pull --ff-only || true
fi

cd "$TARGET_DIR"

# FaceFusion ships its own installer that pulls the right onnxruntime + models.
if command -v conda >/dev/null 2>&1; then
  echo "==> (recommended) create a conda env: conda create -n facefusion python=3.12 -y && conda activate facefusion"
fi

python install.py --onnxruntime "$ONNX" --skip-conda || {
  echo "!! install.py failed. See https://docs.facefusion.io for platform-specific steps." >&2
  exit 1
}

echo "==> Done. Point Settings ▸ faceFusion ▸ facefusionDir at: $TARGET_DIR"
echo "    Test the connection in the app; the first swap downloads model weights."
