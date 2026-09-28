import json
import os
import subprocess
import sys
import tempfile
import unittest

from merge_data import merge_records

PIPELINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")


class MergeRecordsTest(unittest.TestCase):
    def test_community_label_overrides_baseline(self):
        baseline = [
            {"text": "550 a", "label": "unknown"},
            {"text": "550 b", "label": "spam_blocked"},
        ]
        community = [{"text": "550 a", "label": "user_unknown"}]
        merged, overridden = merge_records(baseline, community)
        self.assertEqual(
            merged,
            [
                {"text": "550 a", "label": "user_unknown"},
                {"text": "550 b", "label": "spam_blocked"},
            ],
        )
        self.assertEqual(overridden, 1)

    def test_same_label_is_not_counted_as_override(self):
        baseline = [{"text": "550 a", "label": "unknown"}]
        community = [{"text": "550 a", "label": "unknown"}]
        merged, overridden = merge_records(baseline, community)
        self.assertEqual(len(merged), 1)
        self.assertEqual(overridden, 0)

    def test_new_community_rows_are_appended(self):
        baseline = [{"text": "550 a", "label": "unknown"}]
        community = [{"text": "550 c", "label": "mailbox_full"}]
        merged, _ = merge_records(baseline, community)
        self.assertEqual([r["text"] for r in merged], ["550 a", "550 c"])

    def test_last_occurrence_wins_within_a_source(self):
        community = [
            {"text": "550 a", "label": "unknown"},
            {"text": "550 a", "label": "relay_denied"},
        ]
        merged, _ = merge_records([], community)
        self.assertEqual(merged, [{"text": "550 a", "label": "relay_denied"}])


class MergeCliTest(unittest.TestCase):
    def test_gold_rows_are_excluded_and_community_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            baseline = os.path.join(tmp, "baseline.jsonl")
            community = os.path.join(tmp, "community.jsonl")
            gold = os.path.join(tmp, "gold.jsonl")
            output = os.path.join(tmp, "out", "merged.jsonl")
            write_jsonl(baseline, [
                {"text": "550 a", "label": "unknown"},
                {"text": "550 gold", "label": "spam_blocked"},
            ])
            write_jsonl(community, [
                {"text": "550 a", "label": "user_unknown"},
                {"text": "550 gold", "label": "ip_blacklisted"},
            ])
            write_jsonl(gold, [{"text": "550 gold", "label": "ip_blacklisted"}])
            env = {k: v for k, v in os.environ.items() if k not in ("GOLD_SET_PATH", "PRIVATE_BASELINE_PATH")}
            subprocess.run(
                [sys.executable, "merge_data.py", "--community", community,
                 "--baseline", baseline, "--exclude", gold, "--output", output],
                cwd=PIPELINE_DIR, env=env, check=True, capture_output=True,
            )
            with open(output, encoding="utf-8") as f:
                rows = [json.loads(line) for line in f]
            self.assertEqual(rows, [{"text": "550 a", "label": "user_unknown"}])


if __name__ == "__main__":
    unittest.main()
