import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";
const VALID = { MONGODB_URI: "mongodb://127.0.0.1:27017", MONGODB_DB: "cadence_test" };
describe("MongoDB environment validation", () => {
  it("accepts standard and Atlas URIs with an explicit database", () => {
    expect(parseEnv(VALID).MONGODB_DB).toBe("cadence_test");
    expect(parseEnv({ ...VALID, MONGODB_URI: "mongodb+srv://example.mongodb.net", NODE_ENV: "production" }).NODE_ENV).toBe("production");
  });
  it("defaults NODE_ENV to development", () => { expect(parseEnv(VALID).NODE_ENV).toBe("development"); });
  it("rejects missing MongoDB settings", () => {
    expect(() => parseEnv({})).toThrow(/MONGODB_URI/);
    expect(() => parseEnv({ ...VALID, MONGODB_URI: "" })).toThrow(/MONGODB_URI/);
    expect(() => parseEnv({ MONGODB_URI: VALID.MONGODB_URI })).toThrow(/MONGODB_DB/);
  });
  it("rejects obsolete URLs and invalid database names", () => {
    expect(() => parseEnv({ ...VALID, MONGODB_URI: "postgresql://localhost/db" })).toThrow(/MongoDB connection string/);
    expect(() => parseEnv({ ...VALID, MONGODB_DB: "../bad" })).toThrow(/MONGODB_DB/);
  });
  it("rejects unknown NODE_ENV values", () => { expect(() => parseEnv({ ...VALID, NODE_ENV: "staging" })).toThrow(/NODE_ENV/); });
  it("keeps the AI key strictly optional", () => {
    expect(parseEnv(VALID).OPENAI_API_KEY).toBeUndefined();
    expect(parseEnv({ ...VALID, OPENAI_API_KEY: "sk-test" }).OPENAI_API_KEY).toBe("sk-test");
    expect(() => parseEnv({ ...VALID, OPENAI_API_KEY: "" })).toThrow(/OPENAI_API_KEY/);
  });
});