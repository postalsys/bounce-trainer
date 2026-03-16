import { Router } from "express";
import requireAdmin from "../middleware/require-admin.js";
import requireAuth from "../middleware/require-auth.js";

const router = Router();

router.get("/", (req, res) => {
  res.render("index", { user: req.user || null });
});

router.get("/my-proposals", requireAuth, (req, res) => {
  res.render("my-proposals", { user: req.user });
});

router.get("/admin", requireAdmin, (req, res) => {
  res.render("admin", { user: req.user });
});

router.get("/labels", (req, res) => {
  res.render("labels", { user: req.user || null });
});

export default router;
