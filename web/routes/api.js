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
