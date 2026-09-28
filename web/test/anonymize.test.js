import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { anonymizeMessage } from "../lib/anonymize.js";

// Shared with bounce-data's normalize_bounces.py tests
const { cases } = JSON.parse(
  readFileSync(
    new URL("../../data/anonymize-fixtures.json", import.meta.url),
    "utf8",
  ),
);

describe("anonymizeMessage", () => {
  it("matches the shared fixtures", () => {
    for (const [raw, expected] of cases) {
      assert.equal(anonymizeMessage(raw), expected, raw);
    }
  });

  it("is idempotent", () => {
    for (const [raw] of cases) {
      const once = anonymizeMessage(raw);
      assert.equal(anonymizeMessage(once), once, raw);
    }
  });
});
