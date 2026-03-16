import { Router } from "express";
import express from "express";
import { resolve } from "path";
import { existsSync } from "fs";
import rateLimit from "express-rate-limit";
import { classify, initialize } from "@postalsys/bounce-classifier";
import requireAuth from "../middleware/require-auth.js";
import { anonymizeMessage } from "../lib/anonymize.js";
import db from "../db.js";
import config from "../config.js";

const router = Router();

const MAX_MESSAGE_LENGTH = 10000;

const LABEL_INFO = {
  auth_failure: "Authentication or validation failure (SPF/DKIM/DMARC)",
  domain_blacklisted: "Sender domain is on a blocklist",
  geo_blocked: "Blocked due to geographic origin restrictions",
  greylisting: "Temporary deferral, retry later",
  invalid_address: "Malformed or syntactically invalid address",
  ip_blacklisted: "Sender IP is on a blocklist",
  mailbox_disabled: "Mailbox exists but is disabled or suspended",
  mailbox_full: "Mailbox exceeded its storage quota",
  policy_blocked: "Rejected by recipient server policy or content filter",
  rate_limited: "Too many connections or messages, try later",
  relay_denied: "Server does not relay mail for this domain",
  server_error: "Temporary internal error on recipient server",
  spam_blocked: "Classified as spam by content filter",
  unknown: "Bounce reason could not be determined",
  user_unknown: "Recipient email address does not exist",
  virus_detected: "Contains a virus, malware, or prohibited attachment",
};

const VALID_LABELS = Object.keys(LABEL_INFO);

// Per-endpoint rate limits
const classifyLimit = rateLimit({ windowMs: 60_000, max: 30, message: { error: "Too many requests" } });
const proposalLimit = rateLimit({ windowMs: 60_000, max: 10, message: { error: "Too many submissions" } });
const bulkLimit = rateLimit({ windowMs: 60_000, max: 3, message: { error: "Too many bulk uploads" } });

// Larger body parser for bulk CSV only
const bulkBodyParser = express.json({ limit: "2mb" });

// Filter classify response to only safe fields
function safeClassifyResult(result) {
  return {
    label: result.label,
    confidence: result.confidence,
    action: result.action,
    scores: result.scores,
    usedFallback: result.usedFallback || undefined,
    retryAfter: result.retryAfter || undefined,
    blocklist: result.blocklist || undefined,
  };
}

// Classify a message (no auth required)
router.post("/api/classify", classifyLimit, async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }
  try {
    await initialize();
    const truncated = message.trim().slice(0, MAX_MESSAGE_LENGTH);
    const result = await classify(truncated);
    res.json(safeClassifyResult(result));
  } catch {
    res.status(500).json({ error: "Classification failed" });
  }
});

// Get available labels
router.get("/api/labels", (req, res) => {
  res.json(
    VALID_LABELS.map((value) => ({
      value,
      description: LABEL_INFO[value],
    })),
  );
});

// Submit a proposal (requires auth)
router.post("/api/proposals", proposalLimit, requireAuth, async (req, res) => {
  const { message, label } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }
  if (!label || !VALID_LABELS.includes(label)) {
    return res
      .status(400)
      .json({ error: "Invalid label" });
  }

  try {
    const truncated = message.trim().slice(0, MAX_MESSAGE_LENGTH);
    const anonymized = anonymizeMessage(truncated);

    await initialize();
    const classification = await classify(anonymized);

    const stmt = db.prepare(`
      INSERT INTO proposals (github_username, github_id, message_text, proposed_label, model_label, model_confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      req.user.username,
      req.user.id,
      anonymized,
      label,
      classification.label,
      classification.confidence,
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      message_text: anonymized,
      proposed_label: label,
      model_label: classification.label,
      model_confidence: classification.confidence,
    });
  } catch {
    res.status(500).json({ error: "Failed to submit proposal" });
  }
});

// Bulk upload proposals from CSV (requires auth)
router.post("/api/proposals/bulk-csv", bulkLimit, requireAuth, bulkBodyParser, async (req, res) => {
  const { csv } = req.body;

  if (!csv || typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ error: "CSV data is required" });
  }

  // Parse CSV handling quoted fields (RFC 4180)
  const records = [];
  let pos = 0;
  const text = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  function parseField() {
    if (pos >= text.length) return "";
    if (text[pos] === '"') {
      pos++;
      let val = "";
      while (pos < text.length) {
        if (text[pos] === '"') {
          if (pos + 1 < text.length && text[pos + 1] === '"') {
            val += '"';
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          val += text[pos];
          pos++;
        }
      }
      return val;
    }
    let val = "";
    while (pos < text.length && text[pos] !== "," && text[pos] !== "\n") {
      val += text[pos];
      pos++;
    }
    return val;
  }

  while (pos < text.length) {
    const field1 = parseField().trim();
    if (pos < text.length && text[pos] === ",") pos++;
    const field2 = parseField().trim();
    if (pos < text.length && text[pos] === "\n") pos++;
    if (field1 || field2) records.push([field1, field2]);
  }

  if (records.length < 2) {
    return res.status(400).json({ error: "CSV must have a header row and at least one data row" });
  }

  const [h1, h2] = records[0].map((h) => h.toLowerCase());
  if (h1 !== "label" || h2 !== "message") {
    return res.status(400).json({
      error: 'CSV header must be exactly "label,message"',
    });
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < records.length; i++) {
    const [rawLabel, rawMessage] = records[i];
    const label = rawLabel.toLowerCase();
    const message = rawMessage.slice(0, MAX_MESSAGE_LENGTH);

    if (!message) {
      errors.push({ row: i + 1, error: "Empty message" });
      continue;
    }
    if (!VALID_LABELS.includes(label)) {
      errors.push({ row: i + 1, error: "Invalid label" });
      continue;
    }

    rows.push({ label, message });
  }

  if (rows.length === 0) {
    return res.status(400).json({
      error: "No valid rows found",
      details: errors,
    });
  }

  if (rows.length > 500) {
    return res.status(400).json({
      error: `Too many rows (${rows.length}). Maximum 500 per upload.`,
    });
  }

  try {
    await initialize();

    const prepared = [];
    for (const { label, message } of rows) {
      const anonymized = anonymizeMessage(message);
      const classification = await classify(anonymized);
      prepared.push({
        anonymized,
        label,
        modelLabel: classification.label,
        modelConfidence: classification.confidence,
      });
    }

    const stmt = db.prepare(`
      INSERT INTO proposals (github_username, github_id, message_text, proposed_label, model_label, model_confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction((items) => {
      for (const item of items) {
        stmt.run(
          req.user.username,
          req.user.id,
          item.anonymized,
          item.label,
          item.modelLabel,
          item.modelConfidence,
        );
      }
    });

    insertAll(prepared);

    res.status(201).json({
      inserted: prepared.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch {
    res.status(500).json({ error: "Failed to process bulk upload" });
  }
});

// Download community training data (public)
router.get("/api/training-data", (req, res) => {
  const filePath = resolve(config.projectRoot, "data", "community_labeled.jsonl");
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: "No training data available yet" });
  }
  res.download(filePath, "community_labeled.jsonl");
});

// Training data stats (public)
router.get("/api/training-data/stats", (req, res) => {
  const total = db
    .prepare(`SELECT COUNT(*) as count FROM proposals WHERE status = 'approved' AND exported_at IS NOT NULL`)
    .get().count;

  const byLabel = db
    .prepare(`SELECT proposed_label, COUNT(*) as count FROM proposals WHERE status = 'approved' AND exported_at IS NOT NULL GROUP BY proposed_label ORDER BY count DESC`)
    .all();

  res.json({ total, byLabel });
});

// List own proposals
router.get("/api/proposals", requireAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const rows = db
    .prepare(
      `SELECT * FROM proposals WHERE github_username = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(req.user.username, limit, offset);

  const total = db
    .prepare(
      `SELECT COUNT(*) as count FROM proposals WHERE github_username = ?`,
    )
    .get(req.user.username).count;

  res.json({ proposals: rows, total, page, limit });
});

export default router;
