#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="$SCRIPT_DIR/venv"

# Create and activate Python venv if needed
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
    VENV_NEW=1
else
    VENV_NEW=0
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# Install requirements if venv is new
if [ "$VENV_NEW" -eq 1 ]; then
    echo "Installing dependencies from requirements.txt..."
    pip install -r requirements.txt
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
