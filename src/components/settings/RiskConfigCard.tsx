"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { DEFAULT_RISK_CONFIG, FACTOR_KEYS, riskConfigSchema, type RiskConfig } from "@/lib/risk/model";
import { Button, FieldLabel, Input, Skeleton, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";

interface Stored {
  modelVersion: string;
  revision: number;
  config: RiskConfig;
  fingerprint: string;
  isDefault: boolean;
  updatedAt: string | null;
}

const WEIGHT_LABEL: Record<(typeof FACTOR_KEYS)[number], string> = {
  schedule: "Schedule pressure",
  blockedDuration: "Blocked duration",
  dependencies: "Dependencies",
  workload: "Workload",
};
const PARAMS: { key: keyof RiskConfig["params"]; label: string; step: string }[] = [
  { key: "capacityPoints", label: "Capacity (active pt per assignee)", step: "1" },
  { key: "blockedSaturationDays", label: "Blocked days at saturation", step: "0.5" },
  { key: "dependencySaturation", label: "Blockers at saturation", step: "1" },
  { key: "defaultPointsPerDay", label: "Fallback velocity (pt/day)", step: "0.1" },
  { key: "minVelocitySamples", label: "Min velocity samples", step: "1" },
  { key: "velocityUncertainty", label: "Fallback velocity ± (0–0.9)", step: "0.05" },
];

export function RiskConfigCard({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [stored, setStored] = useState<Stored | null>(null);
  const [draft, setDraft] = useState<RiskConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api<{ riskConfig: Stored }>(`/api/risk/config?workspaceId=${workspaceId}`)
      .then((r) => {
        if (!active) return;
        setStored(r.riskConfig);
        setDraft(structuredClone(r.riskConfig.config));
      })
      .catch((e: unknown) => { if (active) setLoadError(e instanceof Error ? e.message : "Could not load the risk model"); });
    return () => { active = false; };
  }, [workspaceId]);

  const validation = draft ? riskConfigSchema.safeParse(draft) : null;
  const weightSum = draft ? FACTOR_KEYS.reduce((s, k) => s + draft.weights[k], 0) : 0;
  const dirty = !!stored && !!draft && JSON.stringify(stored.config) !== JSON.stringify(draft);

  async function save(config: RiskConfig) {
    if (!stored) return;
    setSaving(true);
    try {
      const r = await api<{ riskConfig: Stored }>("/api/risk/config", "PUT", { workspaceId, expectedRevision: stored.revision, config });
      setStored(r.riskConfig);
      setDraft(structuredClone(r.riskConfig.config));
      push({ title: `Risk model saved — revision ${r.riskConfig.revision}`, description: "All risk scores now use the new configuration.", tone: "success" });
      router.refresh();
    } catch (e) {
      push({ title: "Could not save the risk model", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-5" aria-labelledby="risk-config-title" data-testid="risk-config">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h2 id="risk-config-title" className="panel-title text-[14px] font-semibold">Deadline-risk model</h2>
        {stored && canEdit && (
          <details className="text-[10.5px] text-mist-500"><summary>Configuration details</summary><span>v{stored.modelVersion} · revision {stored.revision} · {stored.isDefault ? "defaults" : "custom"} · {stored.fingerprint}</span></details>
        )}
      </div>
      <p className="mb-4 text-[12px] text-mist-500">
        Weights must sum to 1. Changing the model rescores every open task. {canEdit ? "" : "Only admins and owners can edit."}
      </p>
      {loadError ? (
        <p role="alert" className="text-[12.5px] text-rose-300">{loadError}</p>
      ) : !draft ? (
        <Skeleton className="h-40" />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (validation?.success) void save(validation.data); }}>
          <fieldset disabled={!canEdit || saving} className="space-y-4">
            <legend className="sr-only">Risk weights and parameters</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {FACTOR_KEYS.map((k) => (
                <div key={k}>
                  <FieldLabel htmlFor={`weight-${k}`}>{WEIGHT_LABEL[k]}</FieldLabel>
                  <Input id={`weight-${k}`} type="number" min={0} max={1} step={0.05} value={draft.weights[k]} aria-label={`${WEIGHT_LABEL[k]} weight`}
                    onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, [k]: Number(e.target.value) } })} />
                </div>
              ))}
            </div>
            <p className={Math.abs(weightSum - 1) < 1e-6 ? "font-mono text-[11px] text-mist-500" : "font-mono text-[11px] text-rose-300"} aria-live="polite">
              Σ weights = {Math.round(weightSum * 1000) / 1000}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {PARAMS.map((p) => (
                <div key={p.key}>
                  <FieldLabel htmlFor={`param-${p.key}`}>{p.label}</FieldLabel>
                  <Input id={`param-${p.key}`} type="number" step={p.step} value={draft.params[p.key]} aria-label={p.label}
                    onChange={(e) => setDraft({ ...draft, params: { ...draft.params, [p.key]: Number(e.target.value) } })} />
                </div>
              ))}
              <div>
                <FieldLabel htmlFor="medium-threshold">Medium from (score)</FieldLabel>
                <Input id="medium-threshold" type="number" value={draft.bands.mediumFrom} aria-label="Medium band threshold"
                  onChange={(e) => setDraft({ ...draft, bands: { ...draft.bands, mediumFrom: Number(e.target.value) } })} />
              </div>
              <div>
                <FieldLabel htmlFor="high-threshold">High from (score)</FieldLabel>
                <Input id="high-threshold" type="number" value={draft.bands.highFrom} aria-label="High band threshold"
                  onChange={(e) => setDraft({ ...draft, bands: { ...draft.bands, highFrom: Number(e.target.value) } })} />
              </div>
            </div>
            {validation && !validation.success && (
              <p role="alert" className="text-[12px] text-rose-300">
                {validation.error.issues[0]?.path.join(".")}: {validation.error.issues[0]?.message}
              </p>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!dirty || !validation?.success || saving}>
                  {saving ? <Spinner size={14} /> : <Icon name="save" size={13} />} Save model
                </Button>
                <Button type="button" variant="outline" disabled={saving} onClick={() => void save(DEFAULT_RISK_CONFIG)}>
                  <Icon name="undo" size={13} /> Reset to defaults
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      )}
    </section>
  );
}
