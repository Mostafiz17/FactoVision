"use client";

import { ErrorPanel } from "@/components/states";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-dvh px-4 py-10">
      <ErrorPanel error={error} reset={reset} homeHref="/login" />
    </main>
  );
}