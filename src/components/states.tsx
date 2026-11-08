"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, Skeleton } from "@/components/ui";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Phase 1 state system: every route has a designed loading skeleton, an
 * accessible error boundary panel, and empty states live in ui/EmptyState.
 * Skeletons mirror the real layout of their page to avoid layout shift.
 */
export function PageSkeleton({ variant }: { variant: "dashboard" | "board" | "analytics" | "page" }) {
  return (
    <div className="mx-auto max-w-[1400px]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <div className="hidden gap-2 sm:flex">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>

      {variant === "dashboard" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-[104px]" />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-12">
            <Skeleton className="h-[380px] lg:col-span-8" />
            <Skeleton className="h-[380px] lg:col-span-4" />
          </div>
          <div className="grid gap-4 lg:grid-cols-12">
            <Skeleton className="h-[360px] lg:col-span-8" />
            <Skeleton className="h-[360px] lg:col-span-4" />
          </div>
        </div>
      )}

      {variant === "board" && (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8 w-28" />)}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[...Array(5)].map((_, c) => (
              <div key={c} className="rounded-2xl border border-line/70 bg-ink-900/50 p-2">
                <Skeleton className="mb-3 mt-1 h-4 w-24" />
                <div className="space-y-2">
                  {[...Array(3 - (c % 2))].map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "analytics" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
          <div className="grid gap-4 lg:grid-cols-12">
            <Skeleton className="h-[340px] lg:col-span-8" />
            <Skeleton className="h-[340px] lg:col-span-4" />
          </div>
          <Skeleton className="h-[360px]" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[320px]" />
            <Skeleton className="h-[320px]" />
          </div>
        </div>
      )}

      {variant === "page" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[210px]" />)}
        </div>
      )}
    </div>
  );
}

/** Accessible route-error panel used by every error.tsx boundary. */
export function ErrorPanel({
  error,
  reset,
  homeHref = "/app",
  className,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref?: string;
  className?: string;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className={cn("mx-auto mt-14 max-w-md", className)} role="alert" aria-live="assertive">
      <div className="card animate-pop p-7 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/12 text-rose-300">
          <Icon name="alert" size={22} />
        </span>
        <h2 className="panel-title mt-4 text-lg font-bold text-mist-100">Something went sideways</h2>
        <p className="mt-2 text-[13px] leading-5 text-mist-400">
          We could not display this page. Retry or return to your workspace. Check the latest state before repeating an action.
        </p>
        {error.digest && (
          <p className="mt-3 rounded-lg border border-line bg-ink-900 px-3 py-1.5 font-mono text-[10.5px] text-mist-600">
            ref: {error.digest}
          </p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={reset}>
            <Icon name="refresh" size={14} /> Try again
          </Button>
          <Link href={homeHref}>
            <Button variant="outline">
              <Icon name="pulse" size={14} /> Mission control
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}