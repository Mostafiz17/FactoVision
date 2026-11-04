import { AsyncLocalStorage } from "node:async_hooks";
import { MongoClient, type ClientSession, type Db } from "mongodb";
import { getEnv } from "@/server/env";
import { verifyDatabase } from "./setup";

const globalMongo = globalThis as typeof globalThis & { cadenceMongo?: Promise<MongoClient>; cadenceMongoReady?: Promise<Db> };
const transactionSession = new AsyncLocalStorage<ClientSession>();
export function getClient(): Promise<MongoClient> {
  if (!globalMongo.cadenceMongo) {
    const client = new MongoClient(getEnv().MONGODB_URI, { maxPoolSize: 20, serverSelectionTimeoutMS: 5000 });
    globalMongo.cadenceMongo = client.connect().catch(async (error: unknown) => {
      globalMongo.cadenceMongo = undefined;
      await client.close();
      throw error;
    });
  }
  return globalMongo.cadenceMongo;
}
export function getDatabase(): Promise<Db> {
  if (!globalMongo.cadenceMongoReady) {
    globalMongo.cadenceMongoReady = getClient().then(async (client) => {
      const database = client.db(getEnv().MONGODB_DB);
      await verifyDatabase(database);
      return database;
    }).catch((error: unknown) => { globalMongo.cadenceMongoReady = undefined; throw error; });
  }
  return globalMongo.cadenceMongoReady;
}
export function sessionOptions() { return { session: transactionSession.getStore() }; }

/** Nested repository/service operations inherit the transaction session.
 * Await operations sequentially. Retryable callbacks must have no external effects.
 */
export async function withTransaction<T>(work: () => Promise<T>): Promise<T> {
  if (transactionSession.getStore()) return work();
  await getDatabase(); // Collections/indexes must exist before a transaction starts.
  const session = (await getClient()).startSession();
  try {
    return await session.withTransaction(() => transactionSession.run(session, work), {
      readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary",
    });
  } finally { await session.endSession(); }
}
export async function closeDatabase() {
  const pending = globalMongo.cadenceMongo;
  globalMongo.cadenceMongo = undefined;
  globalMongo.cadenceMongoReady = undefined;
  if (pending) await (await pending).close();
}
