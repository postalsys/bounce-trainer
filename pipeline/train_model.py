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

# Configuration
MAX_TOKENS = 5000  # Vocabulary size
MAX_LENGTH = 100   # Max sequence length
EMBEDDING_DIM = 64
EPOCHS = 15
BATCH_SIZE = 32

def load_data(filepath):
    """Load labeled data from JSONL file."""
    texts = []
    labels = []
    with open(filepath, 'r') as f:
        for line in f:
            data = json.loads(line)
            texts.append(data['text'])
            labels.append(data['label'])
    return texts, labels

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
    args = parser.parse_args()

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

    # Shuffle data
    indices = np.random.permutation(len(texts))
    texts = [texts[i] for i in indices]
    y = y[indices]

    # Split into train/validation
    split = int(0.9 * len(texts))
    train_texts, val_texts = texts[:split], texts[split:]
    train_y, val_y = y[:split], y[split:]

    print(f"\nTrain: {len(train_texts)}, Validation: {len(val_texts)}")

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
        keras.layers.Embedding(MAX_TOKENS, EMBEDDING_DIM, mask_zero=False),
        keras.layers.Dropout(0.2),
        keras.layers.GlobalAveragePooling1D(),
        keras.layers.Dense(64, activation='relu'),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(len(unique_labels), activation='softmax')
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
        verbose=1
    )

    # Evaluate
    print("\nEvaluating...")
    val_loss, val_acc = model.evaluate(val_sequences, val_y, verbose=0)
    print(f"Validation accuracy: {val_acc:.4f}")

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

    # Convert to TensorFlow.js format using layers format
    import tensorflowjs as tfjs
    tfjs.converters.save_keras_model(model, str(output_dir))
    print(f"  Saved TensorFlow.js model to {output_dir}")

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
    weights_path = output_dir / 'group1-shard1of1.bin'
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
        }, f, indent=2)
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
