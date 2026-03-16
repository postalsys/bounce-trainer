#!/usr/bin/env python3
"""
Deduplicate truncated messages - keep only the longest version when
one message is a prefix of another.
"""

import argparse
import json


def dedupe_truncated(messages: list[str], min_prefix_len: int = 80) -> list[str]:
    """
    Remove messages that are prefixes of other messages.
    Keep the longest version of each message.

    min_prefix_len: minimum length to consider for prefix matching
                   (shorter messages are kept as-is to avoid false matches)
    """
    # Sort by length (longest first) so we process longer messages first
    sorted_msgs = sorted(messages, key=len, reverse=True)

    # Build a set of messages to keep
    kept = set()
    prefix_index = {}  # prefix -> full message

    for msg in sorted_msgs:
        # Check if this message is a prefix of something we've already kept
        is_prefix = False

        # Check various prefix lengths
        for prefix_len in range(min_prefix_len, min(len(msg), 150) + 1, 10):
            prefix = msg[:prefix_len]
            if prefix in prefix_index and prefix_index[prefix] != msg:
                # This message is a prefix of a longer message we already have
                is_prefix = True
                break

        if not is_prefix:
            kept.add(msg)
            # Index this message by its prefixes
            for prefix_len in range(min_prefix_len, min(len(msg), 150) + 1, 10):
                prefix = msg[:prefix_len]
                if prefix not in prefix_index:
                    prefix_index[prefix] = msg

    return list(kept)


def dedupe_truncated_v2(messages: list[str], min_len: int = 80) -> list[str]:
    """
    More aggressive deduplication:
    - Group messages by their first N characters
    - Keep only the longest in each group
    """
    # Group by prefix
    prefix_groups = {}

    for msg in messages:
        if len(msg) < min_len:
            # Short messages - use full message as key
            key = msg
        else:
            # Use first min_len chars as grouping key
            key = msg[:min_len]

        if key not in prefix_groups:
            prefix_groups[key] = []
        prefix_groups[key].append(msg)

    # Keep longest from each group
    result = []
    for key, group in prefix_groups.items():
        # Sort by length descending, take the longest
        group.sort(key=len, reverse=True)
        result.append(group[0])

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Deduplicate truncated bounce messages, keeping the longest version."
    )
    parser.add_argument(
        "--input",
        type=str,
        required=True,
        help="Input JSONL file with messages.",
    )
    parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="Output JSONL file with deduplicated messages.",
    )
    args = parser.parse_args()

    # Load messages
    print(f"Loading messages from {args.input}...")
    messages = []
    with open(args.input, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            messages.append(data["text"])

    print(f"Loaded {len(messages):,} messages")

    # First pass: aggressive prefix-based dedup (80 chars)
    print("\nPass 1: Grouping by 80-char prefix...")
    deduped = dedupe_truncated_v2(messages, min_len=80)
    print(f"  After pass 1: {len(deduped):,} messages")

    # Second pass: with 100 char prefix
    print("\nPass 2: Grouping by 100-char prefix...")
    deduped = dedupe_truncated_v2(deduped, min_len=100)
    print(f"  After pass 2: {len(deduped):,} messages")

    # Third pass: with 120 char prefix
    print("\nPass 3: Grouping by 120-char prefix...")
    deduped = dedupe_truncated_v2(deduped, min_len=120)
    print(f"  After pass 3: {len(deduped):,} messages")

    # Sort for output
    deduped.sort()

    # Save results
    print(f"\nSaving {len(deduped):,} messages to {args.output}")
    with open(args.output, "w", encoding="utf-8") as f:
        for msg in deduped:
            f.write(json.dumps({"text": msg}, ensure_ascii=False) + "\n")

    print(f"\nFinal: {len(messages):,} -> {len(deduped):,} ({len(messages)/len(deduped):.1f}x dedup)")


if __name__ == "__main__":
    main()
