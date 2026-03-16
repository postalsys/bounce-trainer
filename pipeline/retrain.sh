#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/venv"

# Ensure venv exists
if [ ! -d "$VENV_DIR" ]; then
    echo "Python venv not found. Running setup-venv.sh..."
    bash "$SCRIPT_DIR/setup-venv.sh"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# Quick sanity check
if ! python -c "import tensorflow" 2>/dev/null; then
    echo "Dependencies missing. Reinstalling..."
    bash "$SCRIPT_DIR/setup-venv.sh" --clean
    source "$VENV_DIR/bin/activate"
fi

# Create output directory
mkdir -p output

# Step 1: Merge community + optional baseline data
echo ""
echo "=== Merging training data ==="
python merge_data.py

# Step 2: Train model
echo ""
echo "=== Training model ==="
python train_model.py --input output/merged.jsonl --output output/model/

# Step 3: Copy model to classifier package if path is set
if [ -n "${BOUNCE_CLASSIFIER_MODEL_PATH:-}" ]; then
    echo ""
    echo "=== Copying model to $BOUNCE_CLASSIFIER_MODEL_PATH ==="
    mkdir -p "$BOUNCE_CLASSIFIER_MODEL_PATH"
    cp output/model/* "$BOUNCE_CLASSIFIER_MODEL_PATH/"
    echo "Model files copied."
fi

echo ""
echo "Retraining complete. Model files are in $SCRIPT_DIR/output/model/"
