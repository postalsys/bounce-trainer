import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.js reads these at import time
const dataDir = mkdtempSync(join(tmpdir(), "bounce-trainer-test-"));
process.env.SESSION_SECRET = "test-secret";
process.env.ADMIN_USERS = "admin";
process.env.DATABASE_PATH = join(dataDir, "proposals.db");
process.env.TYPESAFE_API_KEY = "";

const { default: express } = await import("express");
const { default: db } = await import("../db.js");
const { default: adminRouter } = await import("../routes/admin-api.js");

let server;
let baseUrl;

before(async () => {
  const insert = db.prepare(
    `INSERT INTO proposals (github_username, github_id, message_text, proposed_label, typesafe_label, typesafe_confidence, created_at)
     VALUES ('u', 1, ?, ?, ?, ?, ?)`,
  );
  insert.run("agrees", "user_unknown", "user_unknown", 0.99, "2026-01-04");
  insert.run("weak dispute", "user_unknown", "spam_blocked", 0.4, "2026-01-01");
  insert.run("strong dispute", "unknown", "server_error", 0.95, "2026-01-02");
  insert.run("not screened", "unknown", null, null, "2026-01-03");

  const app = express();
  app.use((req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { username: "admin" };
    next();
  });
  app.use(adminRouter);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const list = async (query) => {
  const res = await fetch(`${baseUrl}/admin/api/proposals?${query}`);
  return { status: res.status, body: await res.json() };
};

describe("GET /admin/api/proposals sort", () => {
  it("lists newest first by default", async () => {
    const { body } = await list("status=pending");
    assert.equal(body.sort, "newest");
    assert.deepEqual(
      body.proposals.map((p) => p.message_text),
      ["agrees", "not screened", "strong dispute", "weak dispute"],
    );
  });

  it("puts confident TypeSafe disagreements first", async () => {
    const { body } = await list("status=pending&sort=disagreement");
    assert.deepEqual(
      body.proposals.map((p) => p.message_text),
      ["strong dispute", "weak dispute", "agrees", "not screened"],
    );
  });

  it("rejects unknown sort values", async () => {
    for (const sort of ["bogus", "constructor", "created_at;DROP"]) {
      const { status, body } = await list(
        `status=pending&sort=${encodeURIComponent(sort)}`,
      );
      assert.equal(status, 400);
      assert.equal(body.error, "Invalid sort");
    }
  });
});
