import express from "express";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import config from "./config.js";
import passport from "./auth.js";
import authRoutes from "./routes/auth.js";
import pageRoutes from "./routes/pages.js";
import apiRoutes from "./routes/api.js";
import adminApiRoutes from "./routes/admin-api.js";

// Ensure db is initialized on startup
import "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQLiteStore = connectSqlite3(session);

const app = express();

// Trust reverse proxy (Caddy) for X-Forwarded-For headers
app.set("trust proxy", 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

// View engine
app.set("view engine", "ejs");
app.set("views", resolve(__dirname, "views"));

// Body parsing - small limit by default, bulk endpoint overrides
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false }));

// Global rate limit
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// Static files
app.use(express.static(resolve(__dirname, "public")));
app.use(
  "/vendor/bootstrap",
  express.static(resolve(__dirname, "node_modules/bootstrap/dist")),
);
app.use(
  "/vendor/bootstrap-icons",
  express.static(resolve(__dirname, "node_modules/bootstrap-icons/font")),
);

// Sessions
app.use(
  session({
    store: new SQLiteStore({
      db: "sessions.db",
      dir: resolve(__dirname, "data"),
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.baseUrl.startsWith("https"),
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
    },
  }),
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use(authRoutes);
app.use(pageRoutes);
app.use(apiRoutes);
app.use(adminApiRoutes);

// Start
app.listen(config.port, () => {
  console.log(`bounce-trainer running at ${config.baseUrl}`);
  if (config.adminUsers.length) {
    console.log(`Admin users configured: ${config.adminUsers.length}`);
  }
  if (!config.github.clientId) {
    console.log(
      "Warning: GITHUB_CLIENT_ID not set. GitHub OAuth will not work.",
    );
  }
});

export default app;
