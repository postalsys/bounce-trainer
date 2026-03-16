import { Router } from "express";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { spawn } from "child_process";
import requireAdmin from "../middleware/require-admin.js";
import db from "../db.js";
import config from "../config.js";

const router = Router();

const VALID_LABELS = [
  "auth_failure", "domain_blacklisted", "geo_blocked", "greylisting",
  "invalid_address", "ip_blacklisted", "mailbox_disabled", "mailbox_full",
  "policy_blocked", "rate_limited", "relay_denied", "server_error",
  "spam_blocked", "unknown", "user_unknown", "virus_detected",
];

// Track retrain status in memory
let retrainStatus = { running: false, lastLog: "", lastRun: null };

// List proposals with filtering
router.get("/admin/api/proposals", requireAdmin, (req, res) => {
  const status = req.query.status || "pending";
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const validStatuses = ["pending", "approved", "untrained", "rejected"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status filter" });
  }

  let where;
  let params;
  if (status === "untrained") {
    where = "status = 'approved' AND exported_at IS NULL";
    params = [limit, offset];
  } else {
    where = "status = ?";
    params = [status, limit, offset];
  }

  const rows = db
    .prepare(
      `SELECT * FROM proposals WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params);

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM proposals WHERE ${where}`)
    .get(...(status === "untrained" ? [] : [status])).count;

  res.json({ proposals: rows, total, page, limit });
});

// Approve or reject a proposal
router.patch("/admin/api/proposals/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status, notes, label } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Status must be approved or rejected" });
  }

  // Validate label if provided
  if (label && !VALID_LABELS.includes(label)) {
    return res.status(400).json({ error: "Invalid label" });
  }

  // Limit notes length
  if (notes && notes.length > 1000) {
    return res.status(400).json({ error: "Notes too long (max 1000 chars)" });
  }

  const proposal = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id);
  if (!proposal) {
    return res.status(404).json({ error: "Proposal not found" });
  }

  const updates = {
    status,
    reviewer_username: req.user.username,
    reviewer_notes: notes || null,
    reviewed_at: new Date().toISOString(),
  };

  if (label && status === "approved") {
    updates.proposed_label = label;
  }

  const setClauses = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(updates);

  db.prepare(`UPDATE proposals SET ${setClauses} WHERE id = ?`).run(
    ...values,
    id,
  );

  res.json({ ok: true });
});

// Bulk approve/reject
router.post("/admin/api/proposals/bulk", requireAdmin, (req, res) => {
  const { ids, status } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" });
  }
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Status must be approved or rejected" });
  }

  const stmt = db.prepare(`
    UPDATE proposals SET status = ?, reviewer_username = ?, reviewed_at = ?
    WHERE id = ? AND status = 'pending'
  `);

  const now = new Date().toISOString();
  const updateMany = db.transaction((ids) => {
    let updated = 0;
    for (const id of ids) {
      const result = stmt.run(status, req.user.username, now, id);
      updated += result.changes;
    }
    return updated;
  });

  const updated = updateMany(ids);
  res.json({ ok: true, updated });
});

// Export approved proposals to community_labeled.jsonl
router.post("/admin/api/export", requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, message_text, proposed_label FROM proposals WHERE status = 'approved' ORDER BY created_at`,
    )
    .all();

  const outputPath = resolve(config.projectRoot, "data", "community_labeled.jsonl");
  const content = rows
    .map((r) => JSON.stringify({ text: r.message_text, label: r.proposed_label }))
    .join("\n");

  writeFileSync(outputPath, content ? content + "\n" : "");

  // Mark all exported proposals
  const now = new Date().toISOString();
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const markExported = db.transaction((ids) => {
      const stmt = db.prepare(`UPDATE proposals SET exported_at = ? WHERE id = ?`);
      for (const id of ids) stmt.run(now, id);
    });
    markExported(ids);
  }

  res.json({ ok: true, count: rows.length });
});

// Trigger retrain
router.post("/admin/api/retrain", requireAdmin, (req, res) => {
  if (retrainStatus.running) {
    return res.status(409).json({ error: "Retrain already in progress" });
  }

  retrainStatus = { running: true, lastLog: "", lastRun: new Date().toISOString() };

  const scriptPath = resolve(config.projectRoot, "pipeline", "retrain.sh");

  // Minimal environment for child process
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG || "en_US.UTF-8",
  };
  if (config.privateBaselinePath) {
    env.PRIVATE_BASELINE_PATH = config.privateBaselinePath;
  }
  if (config.bounceClassifierModelPath) {
    env.BOUNCE_CLASSIFIER_MODEL_PATH = config.bounceClassifierModelPath;
  }

  const child = spawn("bash", [scriptPath], {
    cwd: resolve(config.projectRoot, "pipeline"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (data) => {
    log += data.toString();
    retrainStatus.lastLog = log;
  });
  child.stderr.on("data", (data) => {
    log += data.toString();
    retrainStatus.lastLog = log;
  });

  child.on("close", (code) => {
    retrainStatus.running = false;
    retrainStatus.lastLog = log + `\nProcess exited with code ${code}`;
  });

  res.json({ ok: true, message: "Retrain started" });
});

// Check retrain status
router.get("/admin/api/retrain/status", requireAdmin, (req, res) => {
  res.json(retrainStatus);
});

// Stats
router.get("/admin/api/stats", requireAdmin, (req, res) => {
  const counts = db
    .prepare(
      `SELECT status, COUNT(*) as count FROM proposals GROUP BY status`,
    )
    .all();

  const labelDist = db
    .prepare(
      `SELECT proposed_label, COUNT(*) as count FROM proposals WHERE status = 'approved' GROUP BY proposed_label ORDER BY count DESC`,
    )
    .all();

  const pendingTraining = db
    .prepare(
      `SELECT COUNT(*) as count FROM proposals WHERE status = 'approved' AND exported_at IS NULL`,
    )
    .get().count;

  res.json({
    statusCounts: Object.fromEntries(counts.map((r) => [r.status, r.count])),
    labelDistribution: labelDist,
    pendingTraining,
  });
});

export default router;
