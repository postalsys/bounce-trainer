#!/usr/bin/env python3
"""
Merge community-contributed labeled data with an optional private baseline dataset.
Deduplicates by exact text match and outputs a single merged JSONL file.
"""

import argparse
import json
import os


def load_jsonl(filepath):
    """Load records from a JSONL file."""
    records = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def main():
    parser = argparse.ArgumentParser(
        description="Merge community and baseline bounce training data."
    )
    parser.add_argument(
        "--community",
        type=str,
        default="../data/community_labeled.jsonl",
        help="Path to community labeled JSONL. Default: ../data/community_labeled.jsonl",
    )
    parser.add_argument(
        "--baseline",
        type=str,
        default=None,
        help="Path to private baseline JSONL. Also reads $PRIVATE_BASELINE_PATH env var.",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="output/merged.jsonl",
        help="Output merged JSONL file. Default: output/merged.jsonl",
    )
    args = parser.parse_args()

    # Resolve baseline path from argument or environment variable
    baseline_path = args.baseline or os.environ.get("PRIVATE_BASELINE_PATH")

    # Load community data
    print(f"Loading community data from {args.community}...")
    community = load_jsonl(args.community)
    print(f"  Community records: {len(community):,}")

    # Load baseline data (optional)
    baseline = []
    if baseline_path:
        print(f"Loading baseline data from {baseline_path}...")
        baseline = load_jsonl(baseline_path)
        print(f"  Baseline records: {len(baseline):,}")
    else:
        print("No baseline data specified (use --baseline or $PRIVATE_BASELINE_PATH).")

    # Merge and deduplicate by exact text
    seen_texts = set()
    merged = []

    # Baseline first so community contributions can override labels
    for record in baseline:
        text = record.get("text", "")
        if text not in seen_texts:
            seen_texts.add(text)
            merged.append(record)

    # Then community data
    community_new = 0
    community_dupes = 0
    for record in community:
        text = record.get("text", "")
        if text not in seen_texts:
            seen_texts.add(text)
            merged.append(record)
            community_new += 1
        else:
            community_dupes += 1

    # Write output
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        for record in merged:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    # Print stats
    print(f"\n{'=' * 50}")
    print("MERGE STATISTICS")
    print(f"{'=' * 50}")
    print(f"  Community records:    {len(community):,}")
    print(f"  Baseline records:     {len(baseline):,}")
    print(f"  Duplicates removed:   {community_dupes:,}")
    print(f"  Merged total:         {len(merged):,}")
    print(f"\nOutput written to {args.output}")


if __name__ == "__main__":
    main()
