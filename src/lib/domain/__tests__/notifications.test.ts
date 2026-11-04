import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  planCommentRecipients,
  planDeadlineAlerts,
} from "../notifications";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OUTSIDER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const members = new Set([A, B, C, D]);

describe("comment notification triggers", () => {
  it("notifies assignee and creator of a plain comment, never the actor", () => {
    const r = planCommentRecipients({ actorId: A, assigneeId: B, creatorId: A, parentAuthorId: null, mentionIds: [], memberIds: members });
    expect(r).toEqual([{ userId: B, kind: "comment" }]);
  });
  it("a mention outranks reply and comment for the same person (one notification each)", () => {
    const r = planCommentRecipients({ actorId: A, assigneeId: B, creatorId: C, parentAuthorId: B, mentionIds: [B, B], memberIds: members });
    expect(r).toEqual([
      { userId: B, kind: "mention" },
      { userId: C, kind: "comment" },
    ]);
  });
  it("reply notifies the parent author with kind reply", () => {
    const r = planCommentRecipients({ actorId: A, assigneeId: null, creatorId: null, parentAuthorId: D, mentionIds: [], memberIds: members });
    expect(r).toEqual([{ userId: D, kind: "reply" }]);
  });
  it("self-mentions and self-replies produce nothing", () => {
    const r = planCommentRecipients({ actorId: A, assigneeId: A, creatorId: A, parentAuthorId: A, mentionIds: [A], memberIds: members });
    expect(r).toEqual([]);
  });
  it("non-members (e.g. removed users, other tenants) are never notified", () => {
    const r = planCommentRecipients({ actorId: A, assigneeId: OUTSIDER, creatorId: null, parentAuthorId: OUTSIDER, mentionIds: [OUTSIDER], memberIds: members });
    expect(r).toEqual([]);
  });
});

describe("deadline alerts", () => {
  const now = new Date("2026-03-10T12:00:00.000Z");
  const base = { title: "T", status: "in_progress", assigneeId: B };

  it("classifies overdue and due-soon tasks and skips far-future, done, unassigned and undated tasks", () => {
    const alerts = planDeadlineAlerts([
      { ...base, id: "t1", dueDate: new Date("2026-03-09T00:00:00.000Z") },
      { ...base, id: "t2", dueDate: new Date("2026-03-11T06:00:00.000Z") },
      { ...base, id: "t3", dueDate: new Date("2026-03-20T00:00:00.000Z") },
      { ...base, id: "t4", status: "done", dueDate: new Date("2026-03-09T00:00:00.000Z") },
      { ...base, id: "t5", assigneeId: null, dueDate: new Date("2026-03-09T00:00:00.000Z") },
      { ...base, id: "t6", dueDate: null },
    ], now);
    expect(alerts.map((a) => [a.taskId, a.kind])).toEqual([["t1", "overdue"], ["t2", "deadline_soon"]]);
    expect(alerts.every((a) => a.userId === B)).toBe(true);
  });
  it("boundary: due exactly now is 'soon', not overdue; exactly at horizon is included", () => {
    const alerts = planDeadlineAlerts([
      { ...base, id: "now", dueDate: new Date(now) },
      { ...base, id: "edge", dueDate: new Date(now.getTime() + 24 * 3_600_000) },
    ], now);
    expect(alerts.map((a) => a.kind)).toEqual(["deadline_soon", "deadline_soon"]);
  });
  it("dedupe keys are stable across sweeps and change when the deadline moves", () => {
    const t = { ...base, id: "t1", dueDate: new Date("2026-03-09T00:00:00.000Z") };
    const k1 = planDeadlineAlerts([t], now)[0].dedupeKey;
    const k2 = planDeadlineAlerts([t], new Date(now.getTime() + 3_600_000))[0].dedupeKey;
    const moved = planDeadlineAlerts([{ ...t, dueDate: new Date("2026-03-08T00:00:00.000Z") }], now)[0].dedupeKey;
    expect(k1).toBe(k2);
    expect(moved).not.toBe(k1);
  });
});

describe("keyset cursors", () => {
  it("round-trips", () => {
    const c = { createdAt: new Date("2026-03-10T12:00:00.123Z"), id: A };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("rejects malformed input instead of guessing", () => {
    expect(decodeCursor("not-base64-$$$")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-03-10T12:00:00.000Z|not-a-uuid").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`garbage|${A}`).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`2026-03-10T12:00:00.000Z|${A}|x`).toString("base64url"))).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});