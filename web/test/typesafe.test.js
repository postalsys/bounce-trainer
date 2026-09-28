import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  API_URL,
  buildRequest,
  definitions,
  prescreenProposal,
  prescreenProposals,
  typesafeLabel,
} from "../lib/typesafe.js";

function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

const answer = (choice, confidence = 0.9) => ({
  model: "jev-1.13.0",
  answers: {
    label: {
      type: "choice",
      choice,
      confidence,
      probabilities: { [choice]: confidence },
    },
  },
});

describe("buildRequest", () => {
  it("asks one Choice over every label", () => {
    const body = buildRequest("550 User unknown", "jev-1.13.0");
    assert.equal(body.model, "jev-1.13.0");
    assert.deepEqual(body.state, { bounce_text: "550 User unknown" });
    assert.equal(body.questions.label.type, "choice");
    assert.equal(Object.keys(body.questions.label.criteria).length, 16);
    assert.equal(definitions.version, "labels-v1");
  });
});

describe("typesafeLabel", () => {
  it("returns the chosen label", async () => {
    const fetchImpl = fakeFetch(answer("user_unknown"));
    const result = await typesafeLabel("550 x", {
      apiKey: "k",
      model: "jev-1.13.0",
      fetchImpl,
    });
    assert.deepEqual(result, {
      label: "user_unknown",
      confidence: 0.9,
      model: "jev-1.13.0",
    });
    const [{ url, init }] = fetchImpl.calls;
    assert.equal(url, API_URL);
    assert.equal(init.headers.Authorization, "Bearer k");
    assert.equal(JSON.parse(init.body).state.bounce_text, "550 x");
  });

  it("rejects HTTP errors and answers outside the label set", async () => {
    const opts = { apiKey: "k", model: "m" };
    await assert.rejects(
      typesafeLabel("x", {
        ...opts,
        fetchImpl: fakeFetch({}, { status: 429 }),
      }),
      /status 429/,
    );
    for (const bad of [{}, answer("not_a_label"), answer("constructor")]) {
      await assert.rejects(
        typesafeLabel("x", { ...opts, fetchImpl: fakeFetch(bad) }),
        /no valid label/,
      );
    }
  });
});

describe("prescreenProposal", () => {
  let db;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE proposals (id INTEGER PRIMARY KEY, message_text TEXT, proposed_label TEXT,
      typesafe_label TEXT, typesafe_confidence REAL, typesafe_model TEXT, typesafe_labels_version TEXT)`);
    db.prepare(
      "INSERT INTO proposals (id, message_text, proposed_label) VALUES (1, 'a', 'unknown'), (2, 'b', 'unknown')",
    ).run();
  });
  const row = (id) =>
    db.prepare("SELECT * FROM proposals WHERE id = ?").get(id);

  it("stores the TypeSafe answer", async () => {
    await prescreenProposal(db, 1, "a", {
      apiKey: "k",
      model: "jev-1.13.0",
      fetchImpl: fakeFetch(answer("server_error", 0.8)),
    });
    assert.equal(row(1).typesafe_label, "server_error");
    assert.equal(row(1).typesafe_confidence, 0.8);
    assert.equal(row(1).typesafe_model, "jev-1.13.0");
    assert.equal(row(1).typesafe_labels_version, "labels-v1");
  });

  it("does nothing without an API key and never throws", async () => {
    const fetchImpl = fakeFetch(answer("server_error"));
    await prescreenProposal(db, 1, "a", { apiKey: "", model: "m", fetchImpl });
    assert.equal(fetchImpl.calls.length, 0);
    const failing = async () => {
      throw new Error("network down");
    };
    const originalError = console.error;
    console.error = () => {};
    try {
      await prescreenProposal(db, 1, "a", {
        apiKey: "k",
        model: "m",
        fetchImpl: failing,
      });
    } finally {
      console.error = originalError;
    }
    assert.equal(row(1).typesafe_label, null);
  });

  it("screens a batch in order", async () => {
    const fetchImpl = fakeFetch(answer("greylisting"));
    await prescreenProposals(
      db,
      [
        { id: 1, text: "a" },
        { id: 2, text: "b" },
      ],
      { apiKey: "k", model: "m", fetchImpl },
    );
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(row(2).typesafe_label, "greylisting");
  });

  it("limits concurrent requests", async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { ok: true, status: 200, json: async () => answer("greylisting") };
    };
    db.prepare(
      "INSERT INTO proposals (id, message_text, proposed_label) VALUES (3, 'c', 'x'), (4, 'd', 'x'), (5, 'e', 'x')",
    ).run();
    const items = [1, 2, 3, 4, 5].map((id) => ({ id, text: String(id) }));
    await prescreenProposals(db, items, {
      apiKey: "k",
      model: "m",
      fetchImpl,
      concurrency: 2,
    });
    assert.equal(peak, 2);
    for (const id of [1, 2, 3, 4, 5])
      assert.equal(row(id).typesafe_label, "greylisting");
    await prescreenProposals(db, [], { apiKey: "k", model: "m", fetchImpl });
  });
});
