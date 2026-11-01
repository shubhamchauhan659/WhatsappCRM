#!/usr/bin/env node
/**
 * End-to-end smoke test against a production build (`npm run build` first).
 *
 * Boots `next start`, then checks over real HTTP that the app serves,
 * that every receivables page is protected by the auth middleware, that
 * the account API refuses anonymous callers, and that security headers
 * are present. Needs no Supabase project: an anonymous request never
 * reaches the database.
 *
 *   npm run build && npm run test:smoke
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.SMOKE_PORT ?? "3107";
const BASE = `http://127.0.0.1:${PORT}`;

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://smoke.example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "smoke-anon-key",
  ENCRYPTION_KEY: "0".repeat(64),
  META_APP_SECRET: "smoke-meta-secret",
  NEXT_TELEMETRY_DISABLED: "1",
  ...process.env,
  PORT,
};

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", PORT, "-H", "127.0.0.1"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

try {
  const up = await waitForServer();
  check("server starts and serves /login", up, up ? "" : output.slice(-500));
  if (up) {
    const login = await fetch(`${BASE}/login`);
    check("/login renders", login.status === 200, `status ${login.status}`);
    check("security header: X-Frame-Options", login.headers.get("x-frame-options") === "DENY");
    check("security header: nosniff", login.headers.get("x-content-type-options") === "nosniff");

    for (const path of [
      "/receivables",
      "/receivables/queue",
      "/receivables/invoices",
      "/receivables/invoices/00000000-0000-0000-0000-000000000000",
      "/receivables/customers",
      "/receivables/follow-ups",
      "/receivables/import",
      "/receivables/reports",
      "/settings",
    ]) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      const location = res.headers.get("location") ?? "";
      check(`anonymous ${path} → /login`, res.status >= 300 && res.status < 400 && location.includes("/login"), `${res.status} ${location}`);
    }

    const api = await fetch(`${BASE}/api/account`, { method: "DELETE", body: "{}" });
    check("anonymous DELETE /api/account is refused", api.status === 401, `status ${api.status}`);
  }
} finally {
  server.kill("SIGTERM");
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} smoke checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
