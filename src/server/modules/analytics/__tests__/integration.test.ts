import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase } from "@/db";
import { store } from "@/db/repository";
import type { DbTaskEvent } from "@/db/schema";
import { buildAnalyticsReport, buildWindow, type AnalyticsFilters, type AnalyticsReport } from "@/lib/analytics";
import { AS_OF, FIXTURE_EDGES, FIXTURE_EVENTS, FIXTURE_SOURCE, FIXTURE_TASKS } from "@/lib/analytics/__tests__/fixture";
import { ApiError } from "@/server/http";
import { loadAnalyticsSource } from "../repository";
import { getAnalyticsReport } from "../service";

/*
 * Database-backed verification. Loads the hand-calculated fixture into MongoDB,
 * then checks that:
 *  - the MongoDB-backed report equals the pure domain report for the same data;
 *  - the MongoDB aggregation daily counts equal counts derived from events (for several
 *    filters and time zones);
 *  - filters, as-of replay and tenant scoping hold through the service layer.
 * Requires the isolated test replica set (see .env). Creates and removes its own rows.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const RUN = randomUUID().slice(0, 8);
const symbolToId = new Map<string, string>();
const idToSymbol = new Map<string, string>();
const bind = (symbol: string): string => {
  const id = randomUUID();
  symbolToId.set(symbol, id);
  idToSymbol.set(id, symbol);
  return id;
};
const idOf = (symbol: string): string => {
  const id = symbolToId.get(symbol);
  if (!id) throw new Error(`fixture symbol not bound: ${symbol}`);
  return id;
};

let wsId: string;
let foreignWs: string;
let foreignProjectId: string;
const userIds = { A: "", B: "", C: "" };

/** Replaces database uuids with fixture symbols so reports can be compared structurally. */
function toSymbols(report: AnalyticsReport): unknown {
  return JSON.parse(JSON.stringify(report).replace(UUID, (m) => idToSymbol.get(m) ?? m));
}

async function expectApiError(promise: Promise<unknown>, status: number): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
}

beforeAll(async () => {
  userIds.A = bind("A");
  userIds.B = bind("B");
  userIds.C = bind("C");
  await store.users.insertMany(
    (["A", "B", "C"] as const).map((k) => ({
      id: userIds[k],
      email: `analytics-${RUN}-${k}@test.dev`,
      name: `Analytics ${k} ${RUN}`,
      passwordHash: "not-used-in-this-test",
    })),
  );

  wsId = bind("WS");
  await store.workspaces.insert({ id: wsId, name: `Analytics fixture ${RUN}`, slug: `analytics-${RUN}`, createdBy: userIds.A });
  await store.memberships.insertMany([
    { workspaceId: wsId, userId: userIds.A, role: "owner" },
    { workspaceId: wsId, userId: userIds.B, role: "member" },
  ]);

  foreignWs = randomUUID();
  foreignProjectId = randomUUID();
  await store.workspaces.insert({ id: foreignWs, name: `Foreign ${RUN}`, slug: `foreign-${RUN}`, createdBy: userIds.C });
  await store.memberships.insert({ workspaceId: foreignWs, userId: userIds.C, role: "owner" });
  await store.projects.insert({ id: foreignProjectId, workspaceId: foreignWs, name: "Foreign", key: "FX", color: "#ffffff" });

  for (const p of ["P1", "P2", "P3"]) bind(p);
  await store.projects.insertMany(
    (["P1", "P2", "P3"] as const).map((p) => ({
      id: idOf(p),
      workspaceId: wsId,
      name: p,
      key: `AN${p.slice(1)}`,
      color: "#7c5cff",
    })),
  );

  for (const t of FIXTURE_TASKS) bind(t.id);
  await store.tasks.insertMany(
    FIXTURE_TASKS.map((t) => ({
      id: idOf(t.id),
      workspaceId: wsId,
      projectId: idOf(t.projectId),
      title: t.title,
      description: "",
      status: t.status,
      priority: t.priority,
      assigneeId: t.assigneeId ? idOf(t.assigneeId) : null,
      creatorId: userIds.A,
      estimatePoints: t.estimatePoints,
      dueDate: t.dueDate,
      position: 0,
      tags: [...t.labels],
      version: 0,
      statusSince: t.createdAt,
      deletedAt: t.deletedAt,
      createdAt: t.createdAt,
      updatedAt: t.createdAt,
    })),
  );

  await store.taskEvents.insertMany(
    FIXTURE_EVENTS.map((e) => ({
      id: randomUUID(),
      workspaceId: wsId,
      taskId: idOf(e.taskId),
      actorId: userIds.A,
      type: e.type as DbTaskEvent["type"],
      fromValue: e.fromValue,
      toValue: e.toValue,
      createdAt: e.at,
    })),
  );

  await store.taskDependencies.insertMany(
    FIXTURE_EDGES.map((e) => ({ workspaceId: wsId, taskId: idOf(e.taskId), dependsOnId: idOf(e.dependsOnId) })),
  );
});

afterAll(async () => { await closeDatabase(); });

describe("MongoDB-backed report matches the hand-calculated domain report", () => {
  it("baseline (7 days, UTC) is identical to the pure fixture report, after id mapping", async () => {
    const expected = buildAnalyticsReport(FIXTURE_SOURCE, { asOf: AS_OF, timeZone: "UTC", days: 7, filters: {} });
    const actual = await getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", asOf: AS_OF, filters: {} });
    expect(toSymbols(actual)).toEqual(expected);
  });

  it("the MongoDB aggregation daily counts equal event-derived counts for every filter and time zone", async () => {
    const filterSets: AnalyticsFilters[] = [
      {},
      { projectId: idOf("P1") },
      { assigneeId: idOf("B") },
      { assigneeId: "none" },
      { label: "ui" },
      { priority: "high" },
    ];
    for (const timeZone of ["UTC", "America/New_York", "Pacific/Kiritimati"]) {
      for (const filters of filterSets) {
        const win = buildWindow(AS_OF, timeZone, 7);
        const source = await loadAnalyticsSource(wsId, win, filters);
        const options = { asOf: AS_OF, timeZone, days: 7, filters };
        const viaMongo = buildAnalyticsReport(source, options);
        const derived = buildAnalyticsReport({ tasks: source.tasks, events: source.events, edges: source.edges }, options);
        expect(viaMongo.daily, `daily ${timeZone} ${JSON.stringify(filters)}`).toEqual(derived.daily);
        expect(viaMongo.throughput, `throughput ${timeZone} ${JSON.stringify(filters)}`).toEqual(derived.throughput);
        expect(viaMongo.weekly, `weekly ${timeZone} ${JSON.stringify(filters)}`).toEqual(derived.weekly);
      }
    }
  });

  it("changing the time zone moves the window start but leaves events far from midnight in the same buckets", async () => {
    const utc = await getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", asOf: AS_OF, filters: {} });
    const ny = await getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "America/New_York", asOf: AS_OF, filters: {} });
    expect(utc.window.startDay).toBe("2026-03-09");
    expect(ny.window.startDay).toBe("2026-03-09");
    expect(ny.window.start).not.toBe(utc.window.start);
    // All fixture completions are far from local midnight, so the completion count is unchanged.
    expect(ny.throughput.completed).toBe(utc.throughput.completed);
  });
});

describe("filters change results through the database", () => {
  it("project P1 narrows completions, cohort and blocked analysis exactly as hand-calculated", async () => {
    const r = await getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", asOf: AS_OF, filters: { projectId: idOf("P1") } });
    expect(r.throughput).toEqual({ created: 3, completed: 3, reopened: 1, net: 2 });
    expect(r.completionRate).toEqual({ eligible: 2, completed: 1, rate: 0.5 });
    expect(r.population.open).toBe(4);
    expect(r.blocked.topBlockers.map((b) => idToSymbol.get(b.taskId))).toEqual(["T9"]);
  });

  it("assignee B: only T2 completes; the cohort is empty so its rate is null", async () => {
    const r = await getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", asOf: AS_OF, filters: { assigneeId: idOf("B") } });
    expect(r.completedTaskIds.map((id) => idToSymbol.get(id))).toEqual(["T2"]);
    expect(r.completionRate.rate).toBeNull();
    expect(r.overdue.count).toBe(1);
  });

  it("unassigned tasks (T5, T11) and label 'ui' select the expected populations", async () => {
    const unassigned = await getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", asOf: AS_OF, filters: { assigneeId: "none" } });
    expect(unassigned.population.open).toBe(2);
    expect(unassigned.blocked.blocked).toBe(1);
    const ui = await getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", asOf: AS_OF, filters: { label: "ui" } });
    expect(ui.completionRate.rate).toBe(1);
    expect(ui.throughput.completed).toBe(3);
  });

  it("as-of replay through the service: 2026-03-12T12:00Z shows earlier state", async () => {
    const r = await getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", asOf: new Date("2026-03-12T12:00:00Z"), filters: {} });
    expect(r.throughput).toMatchObject({ created: 6, completed: 2, reopened: 0 });
    expect(r.population.open).toBe(8);
  });

  it("an empty workspace yields an empty (not zero) report", async () => {
    const r = await getAnalyticsReport(userIds.C, foreignWs, { days: 7, timeZone: "UTC", asOf: AS_OF, filters: {} });
    expect(r.population).toEqual({ tasks: 0, open: 0 });
    expect(r.completionRate.rate).toBeNull();
    expect(r.timing.cycle.p50).toBeNull();
    expect(r.blocked.share).toBeNull();
  });
});

describe("authorization and input validation", () => {
  it("a non-member receives 404 for the whole workspace", async () => {
    await expectApiError(getAnalyticsReport(userIds.C, wsId, { days: 7, timeZone: "UTC", filters: {} }), 404);
  });

  it("a project from another tenant is indistinguishable from a missing project (404)", async () => {
    await expectApiError(
      getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", filters: { projectId: foreignProjectId } }),
      404,
    );
  });

  it("members (role member) may read analytics", async () => {
    const r = await getAnalyticsReport(userIds.B, wsId, { days: 7, timeZone: "UTC", asOf: AS_OF, filters: {} });
    expect(r.throughput.completed).toBe(3);
  });

  it("rejects invalid windows, unknown zones and future replay instants with 400", async () => {
    await expectApiError(getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "Mars/Olympus", filters: {} }), 400);
    await expectApiError(getAnalyticsReport(userIds.A, wsId, { days: 0, timeZone: "UTC", filters: {} }), 400);
    await expectApiError(getAnalyticsReport(userIds.A, wsId, { days: 367, timeZone: "UTC", filters: {} }), 400);
    await expectApiError(
      getAnalyticsReport(userIds.A, wsId, { days: 7, timeZone: "UTC", asOf: new Date(Date.now() + 3_600_000), filters: {} }),
      400,
    );
  });
});
