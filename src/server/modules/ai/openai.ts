import { z } from "zod";
import type { EvidenceBundle } from "@/lib/ai/types";

/**
 * OpenAI-compatible provider (server-side only). The API key is read from the
 * environment per request and is never returned, logged, or embedded in the
 * response. Failure modes are classified so the service can react honestly:
 * timeouts and provider outages fall back to the deterministic narrator; the
 * caller is told which mode produced the text.
 */
export type AiFailureKind = "timeout" | "rate_limited" | "auth" | "server" | "bad_output";

export class AiProviderError extends Error {
  constructor(readonly kind: AiFailureKind, message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

const SYSTEM_PROMPT = [
  "You are a delivery analyst for one team workspace.",
  "You are given an evidence bundle: numbered facts (E01, E02, …) and a closed list of task references.",
  "Rules:",
  "- Use ONLY the supplied facts. Never invent numbers, tasks, people, or dates.",
  '- Return JSON: {"insights":[{"kind":"fact"|"suggestion","severity":"info"|"success"|"warning"|"danger","title":string,"body":string,"evidenceRefs":string[],"taskIds":string[]}]}',
  "- 3 to 6 insights: summarise delivery risks, workload imbalances, and bottlenecks.",
  "- kind=fact restates observed evidence; kind=suggestion proposes an action. Every insight must cite at least one evidence id in evidenceRefs.",
  "- taskIds may only contain ids from the supplied task references.",
  "- Be concise: titles <= 160 chars, bodies <= 600 chars.",
].join(" ");

function userPayload(bundle: EvidenceBundle): string {
  return JSON.stringify({
    workspace: bundle.workspaceName,
    generatedAt: bundle.generatedAt,
    evidence: bundle.facts.map((f) => ({ id: f.id, text: f.text, taskIds: f.taskIds })),
    taskRefs: bundle.taskRefs,
  });
}

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export async function generateWithOpenAI(bundle: EvidenceBundle, opts: OpenAIOptions): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiProviderError("timeout", "Provider response timed out"));
    }, opts.timeoutMs);
  });
  try { return await Promise.race([generateResponse(bundle, opts, controller.signal), deadline]); }
  finally { clearTimeout(timer); }
}

async function generateResponse(bundle: EvidenceBundle, opts: OpenAIOptions, signal: AbortSignal): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.endpoint ?? "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      signal,
      body: JSON.stringify({
        model: opts.model,
        temperature: 0.2,
        max_completion_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPayload(bundle) },
        ],
      }),
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new AiProviderError("timeout", `Provider timed out after ${opts.timeoutMs}ms`);
    }
    throw new AiProviderError("server", e instanceof Error ? e.message : "Network failure");
  }

  if (res.status === 429) throw new AiProviderError("rate_limited", "Provider rate limit or quota exhausted (HTTP 429)");
  if (res.status === 401 || res.status === 403) throw new AiProviderError("auth", `Provider rejected the credentials (HTTP ${res.status})`);
  if (!res.ok) throw new AiProviderError("server", `Provider returned HTTP ${res.status}`);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new AiProviderError("bad_output", "Provider response was not JSON");
  }
  const parsed = chatResponseSchema.safeParse(data);
  if (!parsed.success) throw new AiProviderError("bad_output", "Provider response shape was unexpected");
  const content = parsed.data.choices[0].message.content;
  try {
    return JSON.parse(content);
  } catch {
    throw new AiProviderError("bad_output", "Model content was not valid JSON");
  }
}
