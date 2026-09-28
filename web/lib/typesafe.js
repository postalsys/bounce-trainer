/**
 * TypeSafe pre-screen for community proposals.
 *
 * Asks TypeSafe which of the 16 labels fits an (already anonymized) bounce
 * and stores the answer next to the proposal, so admins can review the
 * proposals where the submitter and TypeSafe disagree first. Runs only when
 * TYPESAFE_API_KEY is set, never blocks a submission, and never throws.
 *
 * @module typesafe
 */

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const API_URL = "https://api.typesafe.ai/v1/systemone";

/** Label definitions shared with the private labeling tools. */
export const definitions = JSON.parse(
  readFileSync(
    resolve(__dirname, "..", "..", "data", "label-definitions-v1.json"),
    "utf8",
  ),
);

/**
 * Request body for one bounce: a Choice over all labels.
 * @param {string} text - Anonymized bounce text.
 * @param {string} model - Versioned TypeSafe model id.
 */
export function buildRequest(text, model) {
  return {
    model,
    state: { bounce_text: text },
    questions: {
      label: {
        type: "choice",
        instructions: definitions.instructions,
        criteria: definitions.labels,
      },
    },
  };
}

/**
 * Ask TypeSafe for the label of one bounce.
 * @returns {Promise<{label: string, confidence: number, model: string}>}
 */
export async function typesafeLabel(
  text,
  { apiKey, model, fetchImpl = fetch, timeoutMs = 15000 },
) {
  const res = await fetchImpl(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequest(text, model)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`TypeSafe request failed with status ${res.status}`);
  }
  const data = await res.json();
  const answer = data?.answers?.label;
  if (!answer || !Object.hasOwn(definitions.labels, answer.choice)) {
    throw new Error("TypeSafe response has no valid label answer");
  }
  return {
    label: answer.choice,
    confidence: answer.confidence,
    model: data.model,
  };
}

/**
 * Label proposals and store the results, a few requests at a time. Errors
 * are logged, not thrown, so callers can fire and forget. Does nothing
 * without an API key.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {{id: number|bigint, text: string}[]} items - Proposal ids and their stored (anonymized) text.
 * @param {{apiKey: string, model: string, fetchImpl?: typeof fetch, concurrency?: number}} options
 */
export async function prescreenProposals(db, items, options) {
  if (!options.apiKey || !items.length) return;
  const update = db.prepare(
    `UPDATE proposals SET typesafe_label = ?, typesafe_confidence = ?, typesafe_model = ?, typesafe_labels_version = ?
     WHERE id = ?`,
  );
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      try {
        const result = await typesafeLabel(item.text, options);
        update.run(
          result.label,
          result.confidence,
          result.model,
          definitions.version,
          item.id,
        );
      } catch (err) {
        console.error(
          `TypeSafe pre-screen failed for proposal ${item.id}: ${err.message}`,
        );
      }
    }
  };
  const workers = Math.min(options.concurrency ?? 4, queue.length);
  await Promise.all(Array.from({ length: workers }, worker));
}

/** Pre-screen a single proposal; see prescreenProposals. */
export function prescreenProposal(db, id, text, options) {
  return prescreenProposals(db, [{ id, text }], options);
}
