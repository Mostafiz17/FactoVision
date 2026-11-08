import { beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardFixture } from "@/lib/ai/__tests__/fixture";

const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), environment: vi.fn(), provider: vi.fn(), membership: vi.fn(), limit: vi.fn() }));
vi.mock("@/server/modules/dashboard/service", () => ({ getDashboard: mocks.dashboard }));
vi.mock("@/server/env", () => ({ getEnv: mocks.environment }));
vi.mock("@/server/auth/limits", () => ({ enforceAuthLimit: mocks.limit }));
vi.mock("@/server/auth/guard", () => ({ requireMembership: mocks.membership, ensureCan: vi.fn() }));
vi.mock("../openai", async (original) => ({ ...await original<typeof import("../openai")>(), generateWithOpenAI: mocks.provider }));
import { getInsights } from "../service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membership.mockResolvedValue({ role: "member" });
  mocks.limit.mockResolvedValue(undefined);
  mocks.dashboard.mockResolvedValue(dashboardFixture());
});
describe("AI scope and transmission disclosure", () => {
  it("no key uses local rules without contacting a provider", async () => {
    mocks.environment.mockReturnValue({});
    const result = await getInsights("user", "workspace", 7, { timeZone: "Asia/Dhaka", filters: { projectId: "project" } });
    expect(result).toMatchObject({ mode: "deterministic", providerAttempted: false });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.dashboard).toHaveBeenCalledWith("user", "workspace", { days: 7, timeZone: "Asia/Dhaka", filters: { projectId: "project" } });
  });
  it("invalid external output discloses that a provider was contacted", async () => {
    mocks.environment.mockReturnValue({ OPENAI_API_KEY: "test-only-key" });
    mocks.provider.mockResolvedValue({ insights: [] });
    expect(await getInsights("user", "workspace", 30)).toMatchObject({ mode: "deterministic", providerAttempted: true });
  });
  it("authorization failure prevents provider and dashboard calls", async () => {
    mocks.membership.mockRejectedValue(new Error("Not authorized"));
    await expect(getInsights("outsider", "workspace", 30)).rejects.toThrow("Not authorized");
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
  });
});
