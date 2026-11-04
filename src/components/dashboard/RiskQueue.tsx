"use client";

import type { RiskItem } from "@/lib/domain/types";
import { STATUS_HEX, timeAgo } from "@/lib/utils";
import { Avatar, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DueChip, RiskPill } from "@/components/tasks/bits";
import { useApp } from "@/components/shell/app-context";

export function RiskQueue({ items }: { items: RiskItem[] }) {
  const { openTask } = useApp();
  if (items.length === 0) {
    return <EmptyState icon="check" title="No open tasks" body="Nothing to score — enjoy the calm or plan the next wave." />;
  }
  return (
    <div className="-mx-1 max-h-[330px] space-y-1 overflow-y-auto px-1">
      {items.map((r, i) => (
        <button
          key={r.taskId}
          onClick={() => openTask(r.taskId)}
          className="group flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-2 text-left transition-all hover:border-line hover:bg-ink-800 animate-rise"
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <RiskPill score={r.score} band={r.band} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-mist-200 group-hover:text-white">{r.title}</span>
            <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-mist-600">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_HEX[r.status] }} />
                {r.topFactor}
              </span>
              <DueChip iso={r.dueDate} />
            </span>
          </span>
          {r.assignee ? (
            <Avatar name={r.assignee.name} hue={r.assignee.avatarHue} size={22} />
          ) : (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-ink-600 text-mist-600" title="Unassigned">
              <Icon name="users" size={10} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ActivityMini({
  activity,
}: {
  activity: { id: string; taskTitle: string; createdAt: string; actor: { name: string; avatarHue: number } | null; type: string }[];
}) {
  const { openTask } = useApp();
  return (
    <div className="space-y-2.5">
      {activity.map((a) => (
        <div key={a.id} className="flex items-start gap-2.5">
          {a.actor ? <Avatar name={a.actor.name} hue={a.actor.avatarHue} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-ink-700" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] leading-4 text-mist-400">
              <b className="text-mist-200">{a.actor?.name ?? "System"}</b>{" "}
              <button onClick={() => openTask((a as { taskId?: string }).taskId ?? "")} className="text-pulse-300/90 hover:text-pulse-200 hover:underline">
                {a.taskTitle}
              </button>
            </p>
            <p className="font-mono text-[9.5px] text-mist-600">{timeAgo(a.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}