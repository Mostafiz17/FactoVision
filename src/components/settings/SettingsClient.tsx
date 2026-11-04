"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import type { MemberDTO, Role, WorkspaceDTO } from "@/lib/domain/types";
import { ROLE_LABEL } from "@/lib/domain/types";
import { can, type Capability } from "@/server/auth/permissions";
import { Avatar, Button, FieldLabel, Input, Select, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/overlays";
import { useToast } from "@/components/toast";
import { RiskConfigCard } from "./RiskConfigCard";

const ROLE_BADGE: Record<Role, string> = {
  owner: "border-pulse-500/50 bg-pulse-600/15 text-pulse-300",
  admin: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  project_manager: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  member: "border-line text-mist-400",
};

export function SettingsClient({
  workspace,
  members,
  currentUserId,
}: {
  workspace: WorkspaceDTO;
  members: MemberDTO[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const allowed = (cap: Capability) => can(workspace.role, cap);
  const isOwner = workspace.role === "owner";
  const isAdmin = allowed("workspace.member.invite");
  const [name, setName] = useState(workspace.name);
  const [savingName, setSavingName] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "project_manager" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [tempCredential, setTempCredential] = useState<{ email: string; password: string } | null>(null);
  const [removing, setRemoving] = useState<MemberDTO | null>(null);

  async function saveName() {
    if (!name.trim() || name === workspace.name) return;
    setSavingName(true);
    try {
      await api(`/api/workspaces/${workspace.id}`, "PATCH", { name: name.trim() });
      push({ title: "Workspace renamed", tone: "success" });
      router.refresh();
    } catch (e) {
      push({ title: "Rename failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setSavingName(false);
    }
  }

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await api<{ member: MemberDTO; tempPassword: string | null }>(
        `/api/workspaces/${workspace.id}/members`,
        "POST",
        { email: inviteEmail.trim(), name: inviteName.trim() || undefined, role: inviteRole },
      );
      if (res.tempPassword) setTempCredential({ email: res.member.email, password: res.tempPassword });
      push({ title: "Member added", description: `${res.member.name} joined as ${res.member.role}.`, tone: "success" });
      setInviteEmail("");
      setInviteName("");
      router.refresh();
    } catch (e) {
      push({ title: "Invite failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(m: MemberDTO, role: "admin" | "project_manager" | "member") {
    try {
      await api(`/api/workspaces/${workspace.id}/members`, "PATCH", { userId: m.id, role });
      push({ title: `${m.name} is now ${role}`, tone: "success" });
      router.refresh();
    } catch (e) {
      push({ title: "Role change failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  async function removeMember() {
    if (!removing) return;
    try {
      await api(`/api/workspaces/${workspace.id}/members`, "DELETE", { userId: removing.id });
      push({ title: `${removing.name} removed`, tone: "info" });
      setRemoving(null);
      router.refresh();
    } catch (e) {
      push({ title: "Remove failed", description: e instanceof Error ? e.message : undefined, tone: "error" });
    }
  }

  return (
    <div className="mx-auto max-w-[860px] space-y-5">
      <div>
        <h1 className="panel-title text-xl font-bold text-mist-100">Workspace settings</h1>
        <p className="text-[12px] text-mist-500">You are <b className="uppercase text-pulse-300">{ROLE_LABEL[workspace.role]}</b> here. Roles are enforced on the server, not just in this UI.</p>
      </div>

      <section className="card p-5">
        <h2 className="panel-title mb-3 text-[14px] font-semibold">General</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <FieldLabel>Workspace name</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!allowed("workspace.rename")} maxLength={80} />
          </div>
          <Button onClick={saveName} disabled={!allowed("workspace.rename") || savingName || !name.trim() || name === workspace.name}>
            {savingName && <Spinner size={14} />} Save
          </Button>
        </div>
        <p className="mt-3 font-mono text-[10.5px] text-mist-600">
          id: {workspace.id} · every query in this workspace is scoped by membership — other tenants get 404s, not data.
        </p>
      </section>

      <RiskConfigCard workspaceId={workspace.id} canEdit={allowed("risk.configure")} />

      {isAdmin && (
        <section className="card p-5">
          <h2 className="panel-title mb-1 text-[14px] font-semibold">Invite a teammate</h2>
          <p className="mb-4 text-[12px] text-mist-500">
            Existing accounts join instantly. New accounts are provisioned with a one-time password shown to you (no email service is configured in this environment).
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_130px_auto]">
            <div>
              <FieldLabel>Email</FieldLabel>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.dev" />
            </div>
            <div>
              <FieldLabel>Name (new accounts)</FieldLabel>
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Optional" maxLength={80} />
            </div>
            <div>
              <FieldLabel>Role</FieldLabel>
              <Select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "admin" | "project_manager" | "member")}
              >
                <option value="member">Member — work on tasks</option>
                <option value="project_manager">Project manager — manage projects</option>
                <option value="admin">Admin — manage members</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
                {inviting ? <Spinner size={14} /> : <Icon name="plus" size={14} />} Invite
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="card overflow-x-auto">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="panel-title text-[14px] font-semibold">Members · {members.length}</h2>
          <span className="text-[11px] text-mist-600">owner &gt; admin &gt; project manager &gt; member</span>
        </div>
        <table className="mt-3 w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-y border-line text-[10px] uppercase tracking-wider text-mist-600">
              <th className="px-5 py-2 font-semibold">Person</th>
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-5 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-line/50">
                <td className="px-5 py-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={m.name} hue={m.avatarHue} size={28} />
                    <span className="text-[13px] font-semibold text-mist-200">
                      {m.name} {m.id === currentUserId && <span className="text-[10px] font-normal text-mist-600">(you)</span>}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3 font-mono text-[11.5px] text-mist-500">{m.email}</td>
                <td className="px-3 py-3">
                  {isOwner && m.role !== "owner" ? (
                    <Select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value as "admin" | "project_manager" | "member")}
                      className="h-7.5 w-auto py-0 text-[11.5px]"
                      aria-label={`Role for ${m.name}`}
                    >
                      <option value="member">Member</option>
                      <option value="project_manager">Project manager</option>
                      <option value="admin">Admin</option>
                    </Select>
                  ) : (
                    <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${ROLE_BADGE[m.role]}`}>
                      {ROLE_LABEL[m.role]}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {m.role !== "owner" && (allowed("workspace.member.remove") || m.id === currentUserId) && (
                    <button onClick={() => setRemoving(m)} className="rounded-lg p-1.5 text-mist-500 hover:bg-rose-500/15 hover:text-rose-300" aria-label={`Remove ${m.name}`}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5">
        <h2 className="panel-title mb-2 flex items-center gap-2 text-[14px] font-semibold"><Icon name="shield" size={15} className="text-lime-300" /> Security posture</h2>
        <ul className="grid gap-1.5 text-[12.5px] leading-5 text-mist-400 sm:grid-cols-2">
          <li>· scrypt password hashing, per-user salts</li>
          <li>· Hashed opaque session tokens, HttpOnly cookies</li>
          <li>· SameSite=Lax + Origin checks on mutations</li>
          <li>· Workspace membership checked on every API call</li>
          <li>· Zod validation at every trust boundary</li>
          <li>· Login throttling per IP</li>
        </ul>
      </section>

      <Modal open={tempCredential !== null} onClose={() => setTempCredential(null)} title="Share this one-time credential" subtitle="Shown once. In production this would be an emailed invite link.">
        <div className="rounded-xl border border-lime-400/30 bg-lime-400/8 p-4 font-mono text-[13px]">
          <p className="text-mist-400">email: <b className="text-mist-100">{tempCredential?.email}</b></p>
          <p className="mt-1 text-mist-400">password: <b className="text-lime-300">{tempCredential?.password}</b></p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => tempCredential && navigator.clipboard.writeText(`${tempCredential.email} / ${tempCredential.password}`)}>
            <Icon name="save" size={13} /> Copy
          </Button>
          <Button onClick={() => setTempCredential(null)}>Done</Button>
        </div>
      </Modal>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={`Remove ${removing?.name}?`} subtitle="They lose access to this workspace immediately. Their tasks and history remain.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" onClick={removeMember}><Icon name="trash" size={13} /> Remove</Button>
        </div>
      </Modal>
    </div>
  );
}