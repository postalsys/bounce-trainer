#!/usr/bin/env bash
# Set up the Python virtual environment for the training pipeline.
# Run this once before using retrain.sh, or again to reinstall dependencies.
#
# Usage:
#   bash setup-venv.sh            # create venv and install deps
#   bash setup-venv.sh --clean    # delete existing venv and start fresh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
MIN_PYTHON="3.10"
# TensorFlow publishes stable wheels only up to this version
MAX_PYTHON="3.13"

# --- Helpers ---

die() { echo "ERROR: $*" >&2; exit 1; }

check_python() {
    local cmd
    for cmd in python3.13 python3.12 python3.11 python3.10 python3 python; do
        if command -v "$cmd" &>/dev/null; then
            local ver
            ver=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
            if "$cmd" -c "import sys; exit(0 if (${MIN_PYTHON//./,}) <= sys.version_info[:2] <= (${MAX_PYTHON//./,}) else 1)" 2>/dev/null; then
                echo "$cmd"
                return
            fi
            echo "Found $cmd ($ver) but need $MIN_PYTHON to $MAX_PYTHON" >&2
        fi
    done
    # uv can provide a managed interpreter when the system one is too new
    if command -v uv &>/dev/null; then
        uv python install "$MAX_PYTHON" >&2 && uv python find "$MAX_PYTHON" && return
    fi
    return 1
}

# --- Main ---

echo "=== Bounce Trainer: Pipeline Environment Setup ==="
echo ""

# Handle --clean flag
if [[ "${1:-}" == "--clean" ]]; then
    if [ -d "$VENV_DIR" ]; then
        echo "Removing existing venv..."
        rm -rf "$VENV_DIR"
    fi
fi

# Find suitable Python
PYTHON=$(check_python) || die "Python $MIN_PYTHON to $MAX_PYTHON is required but not found.
Install it with your package manager:
  Ubuntu/Debian:  sudo apt install python3 python3-venv python3-dev
  Fedora/RHEL:    sudo dnf install python3 python3-devel
  Arch:           sudo pacman -S python
  macOS:          brew install python@3.12
  Any platform:   install uv (https://docs.astral.sh/uv/) and rerun"

PY_VERSION=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')")
echo "Using $PYTHON ($PY_VERSION)"

# Check for venv module (not always installed on Linux)
if ! "$PYTHON" -c "import venv" 2>/dev/null; then
    die "Python venv module is missing.
Install it with:
  Ubuntu/Debian:  sudo apt install python3-venv
  Fedora/RHEL:    sudo dnf install python3-libs"
fi

# Create venv
if [ -d "$VENV_DIR" ]; then
    echo "Venv already exists at $VENV_DIR"
    echo "  (use --clean to recreate from scratch)"
else
    echo "Creating virtual environment..."
    "$PYTHON" -m venv "$VENV_DIR"
fi

# Activate and upgrade pip
echo "Upgrading pip..."
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
pip install --quiet --upgrade pip

# Install requirements
echo "Installing dependencies from requirements.txt..."
pip install -r "$SCRIPT_DIR/requirements.txt"

# Verify key imports
echo ""
echo "Verifying installation..."
python -c "
import tensorflow as tf
import tf_keras
import numpy
print(f'  TensorFlow {tf.__version__}')
print(f'  tf-keras {tf_keras.__version__}')
print(f'  NumPy {numpy.__version__}')
"

echo ""
echo "Setup complete. You can now run:"
echo "  cd $SCRIPT_DIR && bash retrain.sh"
