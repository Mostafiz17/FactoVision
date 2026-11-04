import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { closeDatabase, getClient } from "@/db";
import { setupDatabase, verifyDatabase, INDEXES } from "../setup";
import { formatMongoError } from "../errors";

let database: Db;
beforeEach(async () => {
  // Never use configured Atlas credentials, even if global setup is bypassed.
  if (!/^mongodb:\/\/127\.0\.0\.1:/.test(process.env.MONGODB_URI ?? "")) throw new Error("Setup tests require the isolated local replica set");
  database = (await getClient()).db("cadence_setup_" + randomUUID().replaceAll("-", ""));
});
afterAll(closeDatabase); // The test replica set disposes all temporary databases.

describe("safe MongoDB initialization", () => {
  it("reports a missing namespace with code 26 and setup instructions without creating it at runtime", async () => {
    const failure = await verifyDatabase(database).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 26, codeName: "NamespaceNotFound" });
    expect(formatMongoError(failure)).toContain("npm run db:setup");
    expect(await database.listCollections().toArray()).toHaveLength(0);
  });
  it("creates all existing application collections, validators and required indexes", async () => {
    await setupDatabase(database);
    await expect(verifyDatabase(database)).resolves.toBeUndefined();
    expect((await database.listCollections().toArray()).map((c) => c.name).sort()).toEqual(Object.keys(INDEXES).sort());
    const metadata = await database.listCollections({ name: "users" }, { nameOnly: false }).next();
    expect(metadata?.options?.validator).toBeDefined();
  });
  it("can rerun with existing user data and does not need collMod for matching schemas", async () => {
    await setupDatabase(database);
    const id = randomUUID();
    await database.collection<{ _id: string; [field: string]: unknown }>("users").insertOne({ _id: id, id, email: "preserve@example.test", name: "Preserve", passwordHash: "existing-scrypt-hash", createdAt: new Date(), avatarHue: 42 });
    const before = await database.collection("users").find().toArray();
    const indexes = await database.collection("users").listIndexes().toArray();
    const command = vi.spyOn(database, "command");
    try {
      await setupDatabase(database);
      await verifyDatabase(database);
      expect(command).not.toHaveBeenCalled();
    } finally { command.mockRestore(); }
    expect(await database.collection("users").find().toArray()).toEqual(before);
    expect(await database.collection("users").listIndexes().toArray()).toEqual(indexes);
  });
  it("initializes an empty collection without a validator using the declared schema", async () => {
    await database.createCollection("users");
    await setupDatabase(database);
    await expect(verifyDatabase(database)).resolves.toBeUndefined();
    expect(await database.collection("users").countDocuments()).toBe(0);
  });
  it("refuses to overwrite the schema of a populated unvalidated collection", async () => {
    await database.collection("users").insertOne({ preserved: "existing data" });
    const before = await database.collection("users").find().toArray();
    const failure = await setupDatabase(database).catch((error: unknown) => error);
    expect(formatMongoError(failure)).toContain("will not overwrite");
    expect(await database.collection("users").find().toArray()).toEqual(before);
    expect((await database.listCollections({ name: "users" }, { nameOnly: false }).next())?.options?.validator).toBeUndefined();
  });
  it("preserves custom validators rather than silently replacing them", async () => {
    const validator = { customField: { $type: "string" } };
    await database.createCollection("users", { validator });
    await expect(setupDatabase(database)).rejects.toThrow("setup failed");
    expect((await database.listCollections({ name: "users" }, { nameOnly: false }).next())?.options?.validator).toEqual(validator);
  });
  it("reports index conflicts without dropping the index or modifying records", async () => {
    const reference = (await getClient()).db("cadence_setup_reference_" + randomUUID().replaceAll("-", ""));
    await setupDatabase(reference);
    const validator = (await reference.listCollections({ name: "users" }, { nameOnly: false }).next())?.options?.validator;
    expect(validator).toBeDefined();
    await database.createCollection("users", { validator });
    await database.collection("users").createIndex({ email: 1 }, { name: "users_email_unique", unique: false });
    const id = randomUUID();
    await database.collection<{ _id: string; [field: string]: unknown }>("users").insertOne({ _id: id, id, email: "existing@example.test", name: "Existing", passwordHash: "hash", createdAt: new Date() });
    const before = await database.collection("users").find().toArray();
    const failure = await setupDatabase(database).catch((error: unknown) => error);
    expect([85, 86]).toContain((failure as { code: number }).code);
    expect(formatMongoError(failure)).toContain("will not drop");
    expect(await database.collection("users").find().toArray()).toEqual(before);
    expect((await database.collection("users").listIndexes().toArray()).find((i) => i.name === "users_email_unique")?.unique).not.toBe(true);
  });
  it("tolerates concurrent identical initialization", async () => {
    await Promise.all([setupDatabase(database), setupDatabase(database)]);
    await expect(verifyDatabase(database)).resolves.toBeUndefined();
  });
  it("retains the failed operation, collection and permission error code", async () => {
    const denied = { listCollections: () => ({ next: async () => { throw { name: "MongoServerError", code: 13, codeName: "Unauthorized", message: "not authorized to execute listCollections" }; } }) } as unknown as Db;
    const failure = await setupDatabase(denied).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 13, codeName: "Unauthorized" });
    expect(formatMongoError(failure)).toContain('collection "users"');
    expect(formatMongoError(failure)).toContain("listCollections");
  });
});
