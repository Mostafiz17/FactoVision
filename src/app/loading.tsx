import { Icon } from "@/components/icons";
import { BRAND } from "@/lib/brand";

export default function RootLoading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4" aria-busy="true" aria-live="polite">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-pulse-400 to-pulse-700 text-white shadow-glow"
        style={{ animation: "ping-dot 1.6s ease-out infinite" }}
      >
        <Icon name="pulse" size={26} />
      </span>
      <div className="text-center">
        <p className="panel-title text-base font-bold text-mist-100">{BRAND.name}</p>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-mist-500">Calibrating…</p>
      </div>
    </div>
  );
}
