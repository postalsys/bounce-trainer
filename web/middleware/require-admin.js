export default function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Authentication required" });
    }
    return res.redirect("/auth/github");
  }
  if (!req.user.isAdmin) {
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "Admin access required" });
    }
    return res.status(403).send("Forbidden");
  }
  next();
}
