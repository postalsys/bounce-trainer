import express from "express";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
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

// View engine
app.set("view engine", "ejs");
app.set("views", resolve(__dirname, "views"));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Static files
app.use(express.static(resolve(__dirname, "public")));

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
    console.log(`Admin users: ${config.adminUsers.join(", ")}`);
  }
  if (!config.github.clientId) {
    console.log(
      "Warning: GITHUB_CLIENT_ID not set. GitHub OAuth will not work.",
    );
  }
});

export default app;
