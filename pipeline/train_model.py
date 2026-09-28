#!/usr/bin/env python3
"""
Train a text classification model for bounce messages and export to TensorFlow.js format.
"""

import argparse
import json
import os
import numpy as np
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'  # Suppress TF warnings

import tensorflow as tf
import tf_keras as keras  # Use tf-keras for better TensorFlow.js compatibility
from pathlib import Path
import shutil

from training_utils import class_weights, format_report, per_label_report, stratified_split

# Configuration
MAX_TOKENS = 5000  # Vocabulary size
MAX_LENGTH = 100   # Max sequence length
EMBEDDING_DIM = 64
HIDDEN_DIM = 64
SHARD = 'group1-shard1of1.bin'
# Weight order in the shard, as src/index.js parseWeights() reads it
WEIGHT_ORDER = ['dense/kernel', 'dense/bias', 'dense_1/kernel', 'dense_1/bias', 'embedding/embeddings']
EPOCHS = 15
BATCH_SIZE = 32

def load_data(filepath):
    """Load labeled data from JSONL file."""
    texts = []
    labels = []
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            data = json.loads(line)
            texts.append(data['text'])
            labels.append(data['label'])
    return texts, labels


def export_model(model, output_dir):
    """Write the weights shard and model.json the pure-JS classifier reads.

    Replaces the tensorflowjs converter, whose pinned dependencies no longer
    install next to current TensorFlow. The shard is every weight as
    little-endian float32 in WEIGHT_ORDER. model.json keeps the TensorFlow.js
    layers-model layout.
    """
    by_name = {w.name.split(':')[0]: w.numpy().astype('<f4') for w in model.weights}
    weights = [(name, by_name[name]) for name in WEIGHT_ORDER]
    with open(output_dir / SHARD, 'wb') as f:
        for _, value in weights:
            f.write(value.tobytes())
    with open(output_dir / 'model.json', 'w') as f:
        json.dump({
            'format': 'layers-model',
            'generatedBy': f'keras v{keras.__version__}',
            'convertedBy': 'bounce-trainer train_model.py',
            'modelTopology': {
                'keras_version': keras.__version__,
                'backend': 'tensorflow',
                'model_config': json.loads(model.to_json()),
            },
            'weightsManifest': [{
                'paths': [SHARD],
                'weights': [
                    {'name': name, 'shape': list(value.shape), 'dtype': 'float32'}
                    for name, value in weights
                ],
            }],
        }, f)


def verify_export(output_dir, sequences, expected, num_labels):
    """Re-read the shard the way src/index.js does and compare predictions.

    Guards the weight order and layout that the pure-JS classifier assumes:
    dense kernel [embedding, hidden], dense bias, dense_1 kernel [hidden,
    labels], dense_1 bias, then the embedding table, averaged over all MAX_LENGTH positions.
    """
    data = np.fromfile(output_dir / SHARD, dtype='<f4')
    sizes = [EMBEDDING_DIM * HIDDEN_DIM, HIDDEN_DIM, HIDDEN_DIM * num_labels, num_labels]
    offsets = np.cumsum([0] + sizes)
    k1, b1, k2, b2 = (data[offsets[i]:offsets[i + 1]] for i in range(4))
    embedding = data[offsets[4]:].reshape(-1, EMBEDDING_DIM)
    pooled = embedding[sequences].mean(axis=1)
    hidden = np.maximum(pooled @ k1.reshape(EMBEDDING_DIM, HIDDEN_DIM) + b1, 0)
    logits = hidden @ k2.reshape(HIDDEN_DIM, num_labels) + b2
    probs = np.exp(logits - logits.max(axis=1, keepdims=True))
    probs /= probs.sum(axis=1, keepdims=True)
    max_diff = float(np.abs(probs - expected).max())
    if max_diff > 1e-4:
        raise RuntimeError(f"exported weights do not reproduce Keras output (max diff {max_diff})")
    return max_diff


def main():
    parser = argparse.ArgumentParser(
        description="Train a bounce message classifier and export to TensorFlow.js format."
    )
    parser.add_argument(
        "--input",
        type=str,
        default="output/merged.jsonl",
        help="Input JSONL file with labeled data. Default: output/merged.jsonl",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="output/model/",
        help="Output directory for model files. Default: output/model/",
    )
    parser.add_argument(
        "--class-weight",
        choices=["sqrt", "balanced", "none"],
        default="sqrt",
        help="Loss weighting for rare labels. Default: sqrt (square root of balanced).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for the split and weight init, for reproducible runs.",
    )
    args = parser.parse_args()

    if args.seed is not None:
        keras.utils.set_random_seed(args.seed)

    data_file = Path(args.input)
    output_dir = Path(args.output)

    print("Loading data...")
    texts, labels = load_data(data_file)
    print(f"Loaded {len(texts)} samples")

    # Create label encoder
    unique_labels = sorted(set(labels))
    label_to_id = {label: i for i, label in enumerate(unique_labels)}
    id_to_label = {i: label for label, i in label_to_id.items()}

    print(f"\nLabels ({len(unique_labels)}):")
    for label, idx in label_to_id.items():
        count = labels.count(label)
        print(f"  {idx:2}: {label:<20} ({count} samples)")

    # Convert labels to integers
    y = np.array([label_to_id[label] for label in labels])

    # Stratified split: every label keeps ~10% for validation, so rare
    # labels are measured instead of landing wherever the shuffle put them
    train_idx, val_idx = stratified_split(y, val_fraction=0.1, seed=args.seed)
    train_texts = [texts[i] for i in train_idx]
    val_texts = [texts[i] for i in val_idx]
    train_y, val_y = y[train_idx], y[val_idx]

    print(f"\nTrain: {len(train_texts)}, Validation: {len(val_texts)}")

    weights = class_weights(train_y, len(unique_labels), args.class_weight)
    if weights:
        print(f"\nClass weights ({args.class_weight}):")
        for idx, w in weights.items():
            print(f"  {id_to_label[idx]:<20} {w:.2f}")

    # Create text vectorization layer
    print("\nBuilding vocabulary...")
    vectorize_layer = keras.layers.TextVectorization(
        max_tokens=MAX_TOKENS,
        output_mode='int',
        output_sequence_length=MAX_LENGTH,
        standardize='lower_and_strip_punctuation',
    )

    # Adapt on training data
    vectorize_layer.adapt(train_texts)
    vocab = vectorize_layer.get_vocabulary()
    print(f"Vocabulary size: {len(vocab)}")

    # Vectorize texts
    print("\nVectorizing texts...")
    train_sequences = vectorize_layer(train_texts).numpy()
    val_sequences = vectorize_layer(val_texts).numpy()
    print(f"Train shape: {train_sequences.shape}, Val shape: {val_sequences.shape}")

    # Build model (without vectorization layer - we'll handle that separately in JS)
    print("\nBuilding model...")
    model = keras.Sequential([
        keras.layers.Input(shape=(MAX_LENGTH,), dtype='int32'),
        keras.layers.Embedding(MAX_TOKENS, EMBEDDING_DIM, mask_zero=False, name='embedding'),
        keras.layers.Dropout(0.2),
        keras.layers.GlobalAveragePooling1D(),
        keras.layers.Dense(HIDDEN_DIM, activation='relu', name='dense'),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(len(unique_labels), activation='softmax', name='dense_1')
    ])

    model.compile(
        optimizer='adam',
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )

    model.summary()

    # Train
    print("\nTraining...")
    history = model.fit(
        train_sequences, train_y,
        validation_data=(val_sequences, val_y),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        class_weight=weights,
        verbose=1
    )

    # Evaluate
    print("\nEvaluating...")
    val_loss, val_acc = model.evaluate(val_sequences, val_y, verbose=0)
    print(f"Validation accuracy: {val_acc:.4f}")
    val_probs = model.predict(val_sequences, verbose=0)
    val_pred = np.argmax(val_probs, axis=1)
    val_report = per_label_report(val_y, val_pred, id_to_label)
    print("\nPer-label validation metrics (regex labels, not a gold set):")
    print(format_report(val_report))

    # Test some predictions
    print("\nSample predictions:")
    test_messages = [
        "550 5.1.1 User Unknown",
        "552 5.2.2 Mailbox full",
        "421 4.7.0 Try again later",
        "550 IP blocked by Spamhaus",
        "550 5.7.1 Message rejected due to DMARC policy",
    ]

    test_sequences = vectorize_layer(test_messages).numpy()
    predictions = model.predict(test_sequences, verbose=0)
    for msg, pred in zip(test_messages, predictions):
        label_idx = np.argmax(pred)
        label = id_to_label[label_idx]
        confidence = pred[label_idx]
        print(f"  '{msg[:50]}...' -> {label} ({confidence:.2%})")

    # Export model
    print(f"\nExporting model to {output_dir}...")

    # Create output directory
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)

    # Save Keras model in h5 format for TensorFlow.js compatibility
    keras_model_path = output_dir / 'keras_model.h5'
    model.save(keras_model_path, save_format='h5')
    print(f"  Saved Keras model to {keras_model_path}")

    export_model(model, output_dir)
    print(f"  Saved weights and model.json to {output_dir}")
    max_diff = verify_export(
        output_dir, val_sequences[:500], val_probs[:500], len(unique_labels)
    )
    print(f"  Verified export against Keras (max diff {max_diff:.2e})")

    # Save vocabulary
    vocab_path = output_dir / 'vocab.json'
    with open(vocab_path, 'w') as f:
        json.dump(vocab, f)
    print(f"  Saved vocabulary ({len(vocab)} tokens) to {vocab_path}")

    # Save label mapping
    labels_path = output_dir / 'labels.json'
    with open(labels_path, 'w') as f:
        json.dump({
            'label_to_id': label_to_id,
            'id_to_label': id_to_label
        }, f, indent=2)
    print(f"  Saved label mapping to {labels_path}")

    # Compute model hash from weights file
    import hashlib
    from datetime import datetime, timezone
    weights_path = output_dir / SHARD
    weights_hash = hashlib.sha256(weights_path.read_bytes()).hexdigest()[:16]
    trained_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

    # Save model config
    config_path = output_dir / 'config.json'
    with open(config_path, 'w') as f:
        json.dump({
            'max_tokens': MAX_TOKENS,
            'max_length': MAX_LENGTH,
            'embedding_dim': EMBEDDING_DIM,
            'num_labels': len(unique_labels),
            'validation_accuracy': float(val_acc),
            'training_samples': len(texts),
            'model_hash': weights_hash,
            'trained_at': trained_at,
            'class_weight': args.class_weight,
            'validation_split': 'stratified',
        }, f, indent=2)
    with open(output_dir / 'validation_report.json', 'w') as f:
        json.dump(val_report, f, indent=2)
    print(f"  Saved config to {config_path}")
    print(f"  Model hash: {weights_hash}")

    print("\nDone!")
    print(f"\nModel files in {output_dir}:")
    for f in sorted(output_dir.rglob('*')):
        if f.is_file():
            size = f.stat().st_size
            print(f"  {f.relative_to(output_dir)}: {size:,} bytes")

if __name__ == '__main__':
    main()
