import fs from "node:fs";
import path from "node:path";

let loaded = false;

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "..", ".env")
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = rest.join("=");
    }
  }
}

export function requireEnv(name: string) {
  loadLocalEnv();
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optionalEnv(...names: string[]) {
  loadLocalEnv();
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}
