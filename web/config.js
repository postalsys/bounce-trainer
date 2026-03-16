import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env file if present
const envPath = resolve(__dirname, "..", ".env");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file is optional
}

const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,

  github: {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  },

  sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me",

  adminUsers: (process.env.ADMIN_USERS || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean),

  databasePath: resolve(
    __dirname,
    process.env.DATABASE_PATH || "./data/proposals.db",
  ),

  privateBaselinePath: process.env.PRIVATE_BASELINE_PATH || "",
  bounceClassifierModelPath: process.env.BOUNCE_CLASSIFIER_MODEL_PATH || "",

  projectRoot: resolve(__dirname, ".."),
};

export default config;
