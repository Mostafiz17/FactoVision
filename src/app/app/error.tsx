"use client";

import { ErrorPanel } from "@/components/states";

/** Renders inside the app shell — navigation and workspace context stay usable. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} reset={reset} />;
}