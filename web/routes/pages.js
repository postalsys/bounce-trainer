import { Router } from "express";
import requireAdmin from "../middleware/require-admin.js";

const router = Router();

router.get("/", (req, res) => {
  res.render("index", { user: req.user || null });
});

router.get("/admin", requireAdmin, (req, res) => {
  res.render("admin", { user: req.user });
});

export default router;
