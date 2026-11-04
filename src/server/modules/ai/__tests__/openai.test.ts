import { describe, expect, it, vi } from "vitest";
import { buildEvidence } from "@/lib/ai/evidence";
import { validateInsights } from "@/lib/ai/types";
import { dashboardFixture, FOREIGN_UUID } from "@/lib/ai/__tests__/fixture";
import { AiProviderError, generateWithOpenAI } from "../openai";

const bundle = buildEvidence(dashboardFixture(), "Nova Product Lab", new Date("2026-03-15T12:00:00Z"));
const opts = { apiKey: "sk-test-placeholder", model: "gpt-test", timeoutMs: 50 };

const jsonResponse = (content: unknown, status = 200): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Typed mock of global fetch — no `any`, no untyped escape hatches. */
const mockFetch = (impl: (url: RequestInfo | URL, init: RequestInit | undefined) => Promise<Response>): typeof fetch =>
  vi.fn<typeof fetch>(impl);

describe("OpenAI-compatible provider (mocked fetch)", () => {
  it("returns parsed model content and sends the key only in the Authorization header", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetchImpl = mockFetch(async (url, init) => {
      seenUrl = String(url);
      seenInit = init;
      return jsonResponse({ insights: [] });
    });
    await generateWithOpenAI(bundle, { ...opts, fetchImpl });
    expect(seenUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect((seenInit?.headers as Record<string, string>).authorization).toBe("Bearer sk-test-placeholder");
    // the key must not leak into the request body
    expect(String(seenInit?.body)).not.toContain("sk-test-placeholder");
  });

  it("sends only the evidence bundle — no foreign tenant data, no credentials", async () => {
    let body = "";
    const fetchImpl = mockFetch(async (_url, init) => {
      body = String(init?.body ?? "");
      return jsonResponse({ insights: [] });
    });
    await generateWithOpenAI(bundle, { ...opts, fetchImpl });
    expect(body).not.toContain(FOREIGN_UUID);
    expect(body).not.toContain("sk-test-placeholder");
    expect(body).toContain("E01");
    expect(body).toContain("Highest-risk open tasks");
    const payload = JSON.parse(body) as { messages: { content: string }[] };
    const userContent = payload.messages[1].content;
    expect(userContent).toContain("epsilon");
    expect(userContent).not.toContain(FOREIGN_UUID);
  });

  it("classifies an aborted request (timeout) as AiProviderError kind=timeout", async () => {
    const fetchImpl = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    await expect(generateWithOpenAI(bundle, { ...opts, timeoutMs: 10, fetchImpl })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("classifies provider statuses: 429 rate_limited, 401/403 auth, 5xx server", async () => {
    for (const [status, kind] of [
      [429, "rate_limited"],
      [401, "auth"],
      [403, "auth"],
      [500, "server"],
      [503, "server"],
    ] as const) {
      const fetchImpl = mockFetch(async () => new Response("nope", { status }));
      await expect(generateWithOpenAI(bundle, { ...opts, fetchImpl })).rejects.toMatchObject({ kind });
    }
  });

  it("classifies malformed payloads as bad_output", async () => {
    const notJson = mockFetch(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(generateWithOpenAI(bundle, { ...opts, fetchImpl: notJson })).rejects.toBeInstanceOf(AiProviderError);
    const wrongShape = mockFetch(async () => new Response(JSON.stringify({ choices: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(generateWithOpenAI(bundle, { ...opts, fetchImpl: wrongShape })).rejects.toMatchObject({ kind: "bad_output" });
    const badContent = mockFetch(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "{oops not json" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(generateWithOpenAI(bundle, { ...opts, fetchImpl: badContent })).rejects.toMatchObject({ kind: "bad_output" });
  });

  it("a network failure is classified as server, not swallowed", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(generateWithOpenAI(bundle, { ...opts, fetchImpl })).rejects.toMatchObject({ kind: "server" });
  });

  it("model output flows through the same validation as any provider", async () => {
    const known = bundle.facts[2].id;
    const fetchImpl = mockFetch(async () =>
      jsonResponse({
        insights: [
          { kind: "fact", severity: "danger", title: "Overdue work", body: "Two tasks are overdue.", evidenceRefs: [known], taskIds: [bundle.taskRefs[0].id] },
          { kind: "suggestion", severity: "info", title: "Invented", body: "Do things.", evidenceRefs: ["E99"], taskIds: [] },
        ],
      }),
    );
    const raw = await generateWithOpenAI(bundle, { ...opts, fetchImpl });
    const validated = validateInsights(raw, bundle);
    expect(validated.insights).toHaveLength(1);
    expect(validated.insights[0].title).toBe("Overdue work");
    expect(validated.droppedInvalid).toBe(1); // the uncited suggestion is rejected
  });
});
