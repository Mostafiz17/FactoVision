import { describe, expect, it } from "vitest";
import {
  addDays,
  assertTimeZone,
  buildWindow,
  dayKeysBetween,
  inWindow,
  localDayKey,
  parseDayKey,
  startOfLocalDay,
  weekStartKey,
  weekdayOf,
  zoneOffsetMs,
} from "../time";

const HOUR = 3_600_000;

describe("day keys and calendar arithmetic", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("rejects malformed and impossible day keys", () => {
    expect(() => parseDayKey("2026-02-30")).toThrow(RangeError);
    expect(() => parseDayKey("2026-3-1")).toThrow(RangeError);
    expect(() => parseDayKey("tomorrow")).toThrow(RangeError);
  });
  it("lists inclusive day ranges and rejects reversed ranges", () => {
    expect(dayKeysBetween("2026-03-09", "2026-03-11")).toEqual(["2026-03-09", "2026-03-10", "2026-03-11"]);
    expect(dayKeysBetween("2026-03-11", "2026-03-11")).toEqual(["2026-03-11"]);
    expect(() => dayKeysBetween("2026-03-11", "2026-03-10")).toThrow(RangeError);
  });
});

describe("weeks start on Monday", () => {
  it("maps Sunday and Monday to the correct week starts", () => {
    expect(weekdayOf("2026-03-09")).toBe(1); // Monday
    expect(weekStartKey("2026-03-09")).toBe("2026-03-09");
    expect(weekStartKey("2026-03-15")).toBe("2026-03-09"); // Sunday belongs to the Monday before
    expect(weekStartKey("2026-03-16")).toBe("2026-03-16");
  });
});

describe("time zones and local day boundaries", () => {
  it("rejects unknown IANA zones and accepts real ones", () => {
    expect(() => assertTimeZone("Mars/Olympus")).toThrow(RangeError);
    expect(assertTimeZone("America/New_York")).toBe("America/New_York");
    expect(assertTimeZone("UTC")).toBe("UTC");
  });
  it("UTC days are exactly 24 hours", () => {
    expect(startOfLocalDay("2026-03-09", "UTC").toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect(startOfLocalDay("2026-03-10", "UTC").getTime() - startOfLocalDay("2026-03-09", "UTC").getTime()).toBe(24 * HOUR);
  });
  it("a New York spring-forward day (2026-03-08) is 23 hours long", () => {
    const start = startOfLocalDay("2026-03-08", "America/New_York");
    const next = startOfLocalDay("2026-03-09", "America/New_York");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z"); // EST, UTC-5
    expect(next.getTime() - start.getTime()).toBe(23 * HOUR);
  });
  it("a New York fall-back day (2026-11-01) is 25 hours long", () => {
    const start = startOfLocalDay("2026-11-01", "America/New_York");
    const next = startOfLocalDay("2026-11-02", "America/New_York");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z"); // EDT, UTC-4
    expect(next.getTime() - start.getTime()).toBe(25 * HOUR);
  });
  it("a zone without DST (Asia/Kolkata, UTC+05:30) starts its days at 18:30 UTC", () => {
    expect(startOfLocalDay("2026-03-08", "Asia/Kolkata").toISOString()).toBe("2026-03-07T18:30:00.000Z");
    expect(zoneOffsetMs(new Date("2026-03-08T00:00:00Z"), "Asia/Kolkata")).toBe(5.5 * HOUR);
  });
  it("assigns the same instant to different calendar days in different zones", () => {
    const instant = new Date("2026-03-14T03:30:00Z");
    expect(localDayKey(instant, "UTC")).toBe("2026-03-14");
    expect(localDayKey(instant, "America/New_York")).toBe("2026-03-13"); // 23:30 EDT the day before
    expect(localDayKey(instant, "Pacific/Kiritimati")).toBe("2026-03-14"); // 17:30, UTC+14
  });
});

describe("windows are half-open and as-of aware", () => {
  it("spans exactly N local days; a DST-affected 2-day window is 47 hours in New York", () => {
    const win = buildWindow(new Date("2026-03-09T15:00:00Z"), "America/New_York", 2);
    expect(win.startDay).toBe("2026-03-08");
    expect(win.endDay).toBe("2026-03-09");
    expect(win.dayKeys).toEqual(["2026-03-08", "2026-03-09"]);
    expect((win.endExclusive.getTime() - win.start.getTime()) / HOUR).toBe(47);
  });
  it("a plain UTC 2-day window is 48 hours", () => {
    const win = buildWindow(new Date("2026-03-09T15:00:00Z"), "UTC", 2);
    expect((win.endExclusive.getTime() - win.start.getTime()) / HOUR).toBe(48);
  });
  it("includes the start instant, excludes the end instant, and stops at asOf", () => {
    const win = buildWindow(new Date("2026-03-15T12:00:00Z"), "UTC", 7);
    expect(inWindow(win, new Date("2026-03-09T00:00:00Z"))).toBe(true);
    expect(inWindow(win, new Date("2026-03-08T23:59:59.999Z"))).toBe(false);
    expect(inWindow(win, new Date("2026-03-16T00:00:00Z"))).toBe(false);
    expect(inWindow(win, new Date("2026-03-15T12:00:00Z"))).toBe(true);
    expect(inWindow(win, new Date("2026-03-15T12:00:00.001Z"))).toBe(false);
  });
  it("validates window size and as-of", () => {
    expect(() => buildWindow(new Date("2026-03-15T12:00:00Z"), "UTC", 0)).toThrow(RangeError);
    expect(() => buildWindow(new Date("2026-03-15T12:00:00Z"), "UTC", 367)).toThrow(RangeError);
    expect(() => buildWindow(new Date("2026-03-15T12:00:00Z"), "UTC", 2.5)).toThrow(RangeError);
    expect(() => buildWindow(new Date("not a date"), "UTC", 7)).toThrow(RangeError);
    expect(() => buildWindow(new Date("2026-03-15T12:00:00Z"), "Nowhere/Land", 7)).toThrow(RangeError);
  });
});
