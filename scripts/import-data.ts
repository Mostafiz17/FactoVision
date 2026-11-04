import { loadScriptEnv } from "./env";
import { readFile } from "node:fs/promises";
import { closeDatabase } from "../src/db";
import { importSnapshot, normalizeSnapshot } from "../src/db/import";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run db:import -- snapshot.json [--apply]; default is validation only");
  const snapshot = normalizeSnapshot(JSON.parse(await readFile(file, "utf8")));
  const counts = Object.fromEntries(Object.entries(snapshot).map(([name, rows]) => [name, rows.length]));
  console.log("Validated document counts:", counts);
  if (process.argv.includes("--apply")) {
    loadScriptEnv();
    await importSnapshot(snapshot);
    console.log("Snapshot committed atomically to the empty target database.");
  } else console.log("Validation only; no database connection or writes.");
}
main().catch(() => { console.error("Import failed; check snapshot shape/references and target setup. No partial import is committed."); process.exitCode = 1; }).finally(closeDatabase);
