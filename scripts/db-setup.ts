import { loadScriptEnv } from "./env";
import { closeDatabase, getClient } from "../src/db";
import { setupDatabase, verifyDatabase } from "../src/db/setup";
import { getEnv } from "../src/server/env";
import { formatMongoError } from "../src/db/errors";

async function main() {
  try {
    loadScriptEnv();
    const database = (await getClient()).db(getEnv().MONGODB_DB);
    if (!process.argv.includes("--check")) await setupDatabase(database);
    await verifyDatabase(database);
    console.log(process.argv.includes("--check") ? "MongoDB required indexes are ready (read-only check)." : "MongoDB collections, validators, and indexes are ready.");
  } finally { await closeDatabase(); }
}
main().catch((error: unknown) => { console.error("MongoDB setup failed:", formatMongoError(error)); process.exitCode = 1; });
