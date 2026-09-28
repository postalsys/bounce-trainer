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


def merge_records(baseline, community):
    """Merge baseline and community records, deduplicating by exact text.

    Community records win: a community row whose text already exists in the
    baseline replaces that row's label in place, so admin-approved
    relabels actually reach training. Within each source the last
    occurrence of a text wins. Returns (merged, overridden_count).
    """
    merged = {}
    for record in baseline:
        merged[record.get("text", "")] = record
    overridden = 0
    for record in community:
        text = record.get("text", "")
        previous = merged.get(text)
        if previous is not None and previous.get("label") != record.get("label"):
            overridden += 1
        merged[text] = record
    return list(merged.values()), overridden


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
    parser.add_argument(
        "--exclude",
        type=str,
        default=None,
        help="JSONL whose texts must never be trained on (the gold evaluation set). "
        "Also reads $GOLD_SET_PATH env var.",
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

    merged, community_overrides = merge_records(baseline, community)
    community_new = len(merged) - len({r.get("text", "") for r in baseline})

    # Keep evaluation rows out of training permanently
    exclude_path = args.exclude or os.environ.get("GOLD_SET_PATH")
    excluded = 0
    if exclude_path:
        exclude_texts = {r.get("text", "") for r in load_jsonl(exclude_path)}
        before = len(merged)
        merged = [r for r in merged if r.get("text", "") not in exclude_texts]
        excluded = before - len(merged)
        print(f"Excluded {excluded:,} rows found in {exclude_path}")
    else:
        print(
            "WARNING: no gold set to exclude (--exclude or $GOLD_SET_PATH). "
            "Any evaluation on gold rows that are also in the baseline will be inflated."
        )

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
    print(f"  New from community:   {community_new:,}")
    print(f"  Labels overridden:    {community_overrides:,}")
    print(f"  Excluded (gold set):  {excluded:,}")
    print(f"  Merged total:         {len(merged):,}")
    print(f"\nOutput written to {args.output}")


if __name__ == "__main__":
    main()
