"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/icons";
import { EmptyState } from "@/components/ui";

export interface ChartTable {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}

/**
 * Accessible chart container. The chart itself is decorative to assistive tech
 * (aria-hidden); the figure exposes a title, a one-sentence summary and a data
 * table. The table is always in the DOM (screen-reader only until toggled), so the
 * visual and the accessible data come from the same array.
 */
export function ChartFrame({
  title,
  icon,
  summary,
  table,
  empty,
  emptyText,
  className,
  children,
  testId,
}: {
  title: string;
  icon: IconName;
  summary: string;
  table: ChartTable;
  empty?: boolean;
  emptyText?: string;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const id = useId();
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className={cn("card m-0 p-4 sm:p-5", className)} aria-labelledby={`${id}-t`} aria-describedby={`${id}-s`} data-testid={testId}>
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-pulse-600/15 text-pulse-300" aria-hidden="true">
          <Icon name={icon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-t`} className="panel-title text-[14px] font-semibold text-mist-100">{title}</h2>
          <figcaption id={`${id}-s`} className="mt-0.5 text-[11.5px] text-mist-500">{summary}</figcaption>
        </div>
        {!empty && table.rows.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls={`${id}-d`}
            className="rounded-md border border-line px-2 py-1 text-[10.5px] font-semibold text-mist-400 hover:border-pulse-600 hover:text-mist-100"
          >
            {showTable ? "Show chart" : "View data"}
          </button>
        )}
      </div>
      {empty ? (
        <EmptyState icon={icon} title="No data for these filters" body={emptyText ?? "Try a longer window or clear filters."} />
      ) : (
        <>
          <div aria-hidden="true" className={cn(showTable && "hidden")}>{children}</div>
          <div id={`${id}-d`} className={cn(!showTable && "sr-only", "max-h-[300px] overflow-auto")}>
            <table className="w-full text-left text-[12px]">
              <caption className="sr-only">{table.caption}</caption>
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-mist-500">
                  {table.columns.map((c) => <th key={c} scope="col" className="px-2 py-1.5 font-semibold">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/40">
                    {r.map((cell, j) =>
                      j === 0 ? (
                        <th key={j} scope="row" className="px-2 py-1.5 font-medium text-mist-200">{cell}</th>
                      ) : (
                        <td key={j} className="px-2 py-1.5 font-mono text-mist-300">{cell}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </figure>
  );
}
