import { describe, expect, it } from "vitest";
import { formatMongoError, MongoInitializationError } from "../errors";

const uri = "mongodb+srv://fixture-user:p%40ssword%21@fixture.invalid/?token=fixture-token";
describe("MongoDB error diagnostics", () => {
  it("shows code/name/message and redacts full URIs and standalone credentials", () => {
    const message = "Could not authenticate fixture-user with p%40ssword%21 or p@ssword! token fixture-token; URI " + uri;
    const formatted = formatMongoError({ name: "MongoServerError", message, code: 18, codeName: "AuthenticationFailed" }, uri);
    expect(formatted).toContain("code=18");
    expect(formatted).toContain("AuthenticationFailed");
    for (const secret of [uri, "fixture-user", "p%40ssword%21", "p@ssword!", "fixture-token", "fixture.invalid"]) expect(formatted).not.toContain(secret);
  });
  it("redacts other MongoDB URIs, messages in nested causes and log line breaks", () => {
    const failure = new Error("Connection failed\n", { cause: new Error("mongodb://unconfigured:secret@another.invalid/db") });
    const output = formatMongoError(failure, uri);
    expect(output).toContain("Connection failed");
    expect(output).not.toContain("another.invalid");
    expect(output).not.toContain("\n");
  });
  it("preserves initialization context and code 26", () => {
    const failure = new MongoInitializationError("verify", "users", { code: 26, codeName: "NamespaceNotFound", message: "ns does not exist: example.users" });
    expect(failure.code).toBe(26);
    expect(formatMongoError(failure, uri)).toContain("example.users");
    expect(formatMongoError(failure, uri)).toContain("npm run db:setup");
  });
  it("handles cyclic errors and never dumps driver objects", () => {
    const failure: { message: string; cause?: unknown; password: string } = { message: "safe message", password: "must-not-be-dumped" };
    failure.cause = failure;
    expect(formatMongoError(failure, uri)).toContain("safe message");
    expect(formatMongoError(failure, uri)).not.toContain(failure.password);
  });
  it("keeps actionable environment validation errors visible", () => {
    expect(formatMongoError(new Error("MONGODB_URI is required; MONGODB_DB is required"), uri)).toContain("MONGODB_DB is required");
  });
});
