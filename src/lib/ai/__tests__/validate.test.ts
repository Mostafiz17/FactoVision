import { describe, expect, it } from "vitest";
import { MAX_INSIGHTS, validateInsights } from "../types";
import { buildEvidence } from "../evidence";
import { dashboardFixture } from "./fixture";

const bundle = buildEvidence(dashboardFixture(), "ws", new Date("2026-03-15T12:00:00Z"));
const known = bundle.facts[0].id;
const knownTask = bundle.taskRefs[0]?.id ?? "T5";

const item = (over: Record<string, unknown> = {}) => ({
  kind: "fact",
  severity: "info",
  title: "t",
  body: "b",
  evidenceRefs: [known],
  taskIds: [],
  ...over,
});

describe("structured output validation", () => {
  it("accepts well-formed items citing real evidence", () => {
    const r = validateInsights([item()], bundle);
    expect(r).toEqual({ insights: [item()], droppedInvalid: 0 });
  });

  it("drops items with unknown or missing evidence citations", () => {
    const r = validateInsights([item({ evidenceRefs: ["E99"] }), item({ evidenceRefs: [] }), item()], bundle);
    expect(r.insights).toHaveLength(1);
    expect(r.droppedInvalid).toBe(2);
  });

  it("rejects mixed known and unknown citations", () => {
    const r = validateInsights([item({ evidenceRefs: ["E99", known] })], bundle);
    expect(r.insights).toEqual([]);
    expect(r.droppedInvalid).toBe(1);
  });

  it("strips task ids the bundle never supplied", () => {
    const r = validateInsights([item({ taskIds: [knownTask, "foreign-id"] })], bundle);
    expect(r.insights[0].taskIds).toEqual([knownTask]);
  });

  it("rejects wrong enums, empty strings, oversized bodies and non-array payloads", () => {
    expect(validateInsights([item({ kind: "opinion" })], bundle).droppedInvalid).toBe(1);
    expect(validateInsights([item({ severity: "critical" })], bundle).droppedInvalid).toBe(1);
    expect(validateInsights([item({ title: "" })], bundle).droppedInvalid).toBe(1);
    expect(validateInsights([item({ body: "x".repeat(1201) })], bundle).droppedInvalid).toBe(1);
    expect(validateInsights("not an array", bundle)).toEqual({ insights: [], droppedInvalid: 1 });
    expect(validateInsights(null, bundle).insights).toEqual([]);
  });

  it("caps the list at MAX_INSIGHTS and counts the remainder as dropped", () => {
    const many = Array.from({ length: MAX_INSIGHTS + 4 }, () => item());
    const r = validateInsights(many, bundle);
    expect(r.insights).toHaveLength(MAX_INSIGHTS);
    expect(r.droppedInvalid).toBe(4);
  });
});
