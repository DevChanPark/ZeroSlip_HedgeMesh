import "dotenv/config";

import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const dbPath = resolveSqlitePath(databaseUrl);
const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260520092117_init",
  "migration.sql"
);

mkdirSync(path.dirname(dbPath), { recursive: true });
closeSync(openSync(dbPath, "a"));

const hasSchema = execFileSync("sqlite3", [
  dbPath,
  "SELECT name FROM sqlite_master WHERE type='table' AND name='HedgeIntent';"
])
  .toString("utf8")
  .trim();

if (hasSchema) {
  console.log(JSON.stringify({ initialized: true, skipped: true, database: dbPath }, null, 2));
  process.exit(0);
}

const migrationSql = readFileSync(migrationPath, "utf8");
execFileSync("sqlite3", [dbPath], { input: migrationSql });
console.log(JSON.stringify({ initialized: true, skipped: false, database: dbPath }, null, 2));

function resolveSqlitePath(url) {
  if (!url.startsWith("file:")) {
    throw new Error("Only SQLite file: DATABASE_URL values are supported by db:init");
  }

  const filePath = url.slice("file:".length);
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), "prisma", filePath);
}
