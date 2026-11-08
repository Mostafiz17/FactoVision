"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, FieldLabel, Input, Spinner } from "@/components/ui";

export function AccountSecurity() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <section className="card p-5">
    <h2 className="panel-title text-sm font-semibold">Account security</h2>
    <p className="mt-1 text-xs text-mist-500">Choose a private password. Changing it signs out your other devices.</p>
    <form className="mt-4 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true); setError(null); setMessage(null);
      try {
        await api("/api/auth/password", "POST", { currentPassword: current, newPassword: next });
        setCurrent(""); setNext(""); setMessage("Password updated. Other sessions have been signed out.");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update password"); }
      finally { setBusy(false); }
    }}>
      <div><FieldLabel htmlFor="current-password">Current password</FieldLabel><Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required maxLength={128} /></div>
      <div><FieldLabel htmlFor="new-password">New password</FieldLabel><Input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} maxLength={128} /></div>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {message && <p role="status" className="text-sm text-lime-300">{message}</p>}
      <Button type="submit" disabled={busy || next.length < 8 || !current}>{busy && <Spinner size={14} />} Change password</Button>
    </form>
  </section>;
}
