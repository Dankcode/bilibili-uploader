#!/usr/bin/env bash
# One-time FaceFusion setup for the automated face-swap processor.
# Usage:  bash scripts/install_facefusion.sh [TARGET_DIR] [default|cuda@12|coreml]
# Then set the "faceFusion" connection's facefusionDir to TARGET_DIR in Settings.
set -euo pipefail

TARGET_DIR="${1:-$HOME/facefusion}"
ONNX="${2:-default}"
REPO="https://github.com/facefusion/facefusion.git"
PYTHON_BIN="${FACEFUSION_BOOTSTRAP_PYTHON:-python3}"

echo "==> FaceFusion install"
echo "    dir:        $TARGET_DIR"
echo "    runtime:    $ONNX"

if [ ! -d "$TARGET_DIR/.git" ]; then
  echo "==> Cloning $REPO"
  git clone --depth 1 "$REPO" "$TARGET_DIR"
else
  echo "==> Repo exists, pulling latest"
  git -C "$TARGET_DIR" pull --ff-only || true
fi

cd "$TARGET_DIR"

if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "!! Python 3.10 or newer is required. Set FACEFUSION_BOOTSTRAP_PYTHON to a compatible Python binary." >&2
  exit 1
fi

echo "==> Creating isolated Python environment"
"$PYTHON_BIN" -m venv .venv
.venv/bin/python -m pip install --upgrade pip

# FaceFusion 3.x accepts the ONNX runtime variant as a positional argument.
PATH="$TARGET_DIR/.venv/bin:$PATH" .venv/bin/python install.py "$ONNX" --skip-conda || {
  echo "!! install.py failed. See https://docs.facefusion.io for platform-specific steps." >&2
  exit 1
}

echo "==> Done. Point Settings ▸ faceFusion ▸ facefusionDir at: $TARGET_DIR"
echo "    Set pythonBin to: $TARGET_DIR/.venv/bin/python"
echo "    Use executionProviders=auto unless you need to force a provider."
echo "    Test the connection in the app; the first swap downloads model weights."
