import { describe, expect, it } from "vitest";
import { commentDedupeKey } from "../notifications";

const base = {
  taskId: "T1",
  actorId: "U1",
  parentId: null,
  body: "Please review the migration",
  at: new Date("2026-03-15T12:00:30Z"),
};

describe("comment notification dedupe key", () => {
  it("a retried identical POST within the same minute has the same key", () => {
    expect(commentDedupeKey(base)).toBe(commentDedupeKey({ ...base, at: new Date("2026-03-15T12:00:59Z") }));
  });
  it("different body, parent, task or actor produces a different key", () => {
    const expected = commentDedupeKey(base);
    expect(commentDedupeKey({ ...base, body: "other" })).not.toBe(expected);
    expect(commentDedupeKey({ ...base, parentId: "C1" })).not.toBe(expected);
    expect(commentDedupeKey({ ...base, taskId: "T2" })).not.toBe(expected);
    expect(commentDedupeKey({ ...base, actorId: "U2" })).not.toBe(expected);
  });
  it("the same text deliberately posted in a later minute notifies again", () => {
    expect(commentDedupeKey(base)).not.toBe(commentDedupeKey({ ...base, at: new Date("2026-03-15T12:01:00Z") }));
  });
  it("has a stable, namespaced shape", () => {
    expect(commentDedupeKey(base)).toMatch(/^comment:[0-9a-f]{8}:\d+$/);
  });
});
