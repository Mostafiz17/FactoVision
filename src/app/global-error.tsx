"use client";

import { useEffect } from "react";
import { BRAND } from "@/lib/brand";

/** Last-resort boundary: the root layout itself failed, so styles are inline. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#060a14",
          color: "#eef2fb",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div role="alert" aria-live="assertive" style={{ maxWidth: 420, textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 40, margin: 0 }}>⚠</p>
          <h1 style={{ fontSize: 20, margin: "12px 0 8px" }}>{BRAND.name} hit a critical error</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#93a1bc", margin: 0 }}>
            The application could not be displayed. Reload and check the latest state before repeating an action.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: 11, color: "#4d5a78", marginTop: 12 }}>ref: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "10px 22px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(180deg,#8f76ff,#6a48f2)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload {BRAND.name}
          </button>
        </div>
      </body>
    </html>
  );
}
