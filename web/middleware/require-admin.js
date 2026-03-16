import config from "../config.js";

export default function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    return res.redirect("/auth/github");
  }
  // Recheck admin status from config on every request (not cached in session)
  const isCurrentlyAdmin = config.adminUsers.includes(
    req.user.username.toLowerCase(),
  );
  if (!isCurrentlyAdmin) {
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "Admin access required" });
    }
    return res.status(403).send("Forbidden");
  }
  next();
}
