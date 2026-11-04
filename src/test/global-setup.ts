import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { setupDatabase } from "../db/setup";

/** Tests always use a disposable replica set, never a developer/Atlas database. */
export default async function setup() {
  process.env.MONGOMS_DOWNLOAD_DIR = path.resolve("tmp/mongodb-binaries");
  const cachedBinary = path.resolve("tmp/mongodb-binaries/mongod.exe");
  const systemBinary = process.env.MONGOMS_SYSTEM_BINARY ?? (process.platform === "win32" && existsSync(cachedBinary) ? cachedBinary : undefined);
  const replica = await MongoMemoryReplSet.create({ binary: { version: "8.2.6", ...(systemBinary ? { systemBinary } : {}) }, replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGODB_URI = replica.getUri();
  process.env.MONGODB_DB = "cadence_test_" + randomUUID().replaceAll("-", "");
  const client = await new MongoClient(process.env.MONGODB_URI).connect();
  try { await setupDatabase(client.db(process.env.MONGODB_DB)); }
  finally { await client.close(); }
  return async () => { await replica.stop(); };
}
