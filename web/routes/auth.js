import { Router } from "express";
import passport from "../auth.js";

const router = Router();

router.get("/auth/github", passport.authenticate("github", { scope: [] }));

router.get(
  "/auth/github/callback",
  passport.authenticate("github", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/");
  },
);

router.get("/auth/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

export default router;
