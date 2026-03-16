import { Router } from "express";
import { classify, initialize, getLabels } from "@postalsys/bounce-classifier";
import requireAuth from "../middleware/require-auth.js";
import { anonymizeMessage } from "../lib/anonymize.js";
import db from "../db.js";

const router = Router();

const VALID_LABELS = [
  "auth_failure",
  "domain_blacklisted",
  "geo_blocked",
  "greylisting",
  "invalid_address",
  "ip_blacklisted",
  "mailbox_disabled",
  "mailbox_full",
  "policy_blocked",
  "rate_limited",
  "relay_denied",
  "server_error",
  "spam_blocked",
  "unknown",
  "user_unknown",
  "virus_detected",
];

// Classify a message (no auth required)
router.post("/api/classify", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }
  try {
    await initialize();
    const result = await classify(message.trim());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get available labels
router.get("/api/labels", (req, res) => {
  res.json(VALID_LABELS);
});

// Submit a proposal (requires auth)
router.post("/api/proposals", requireAuth, async (req, res) => {
  const { message, label } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }
  if (!label || !VALID_LABELS.includes(label)) {
    return res
      .status(400)
      .json({ error: `Invalid label. Must be one of: ${VALID_LABELS.join(", ")}` });
  }

  try {
    // Anonymize the message before storing
    const anonymized = anonymizeMessage(message.trim());

    // Classify with current model
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk upload proposals from CSV (requires auth)
router.post("/api/proposals/bulk-csv", requireAuth, async (req, res) => {
  const { csv } = req.body;

  if (!csv || typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ error: "CSV data is required" });
  }

  // Parse CSV handling quoted fields (RFC 4180)
  // Quoted fields may contain commas, newlines, and escaped quotes ("")
  const records = [];
  let pos = 0;
  const text = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  function parseField() {
    if (pos >= text.length) return "";
    if (text[pos] === '"') {
      pos++; // skip opening quote
      let val = "";
      while (pos < text.length) {
        if (text[pos] === '"') {
          if (pos + 1 < text.length && text[pos + 1] === '"') {
            val += '"';
            pos += 2;
          } else {
            pos++; // skip closing quote
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

  // Validate header
  const [h1, h2] = records[0].map((h) => h.toLowerCase());
  if (h1 !== "label" || h2 !== "message") {
    return res.status(400).json({
      error: 'CSV header must be exactly "label,message"',
    });
  }

  // Validate rows
  const rows = [];
  const errors = [];
  for (let i = 1; i < records.length; i++) {
    const [rawLabel, message] = records[i];
    const label = rawLabel.toLowerCase();

    if (!message) {
      errors.push({ row: i + 1, error: "Empty message" });
      continue;
    }
    if (!VALID_LABELS.includes(label)) {
      errors.push({ row: i + 1, error: `Invalid label "${rawLabel}"` });
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

  // Cap at 500 rows per upload
  if (rows.length > 500) {
    return res.status(400).json({
      error: `Too many rows (${rows.length}). Maximum 500 per upload.`,
    });
  }

  try {
    await initialize();

    // Anonymize and classify each row
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

    // Insert all in a single transaction
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
