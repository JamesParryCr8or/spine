"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, ShieldCheck, Trash2, Users } from "lucide-react";

type Role = { key: string; label: string; description: string; can_view_reports: boolean; can_view_customer_details: boolean; can_manage_data: boolean; can_manage_connections: boolean; can_manage_team: boolean };
type Member = { user_id: string; email: string | null; role: string; created_at: string };
type Invitation = { id: string; email: string; role: string; created_at: string; expires_at: string };
type TeamData = { role: string; userId: string; canManageTeam: boolean; roles: Role[]; members: Member[]; invitations: Invitation[] };

export function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/team", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load team");
    setData(payload);
  }, []);
  useEffect(() => { void load().catch((reason) => setError(reason.message)); }, [load]);

  const mutate = async (method: "POST" | "PATCH" | "DELETE", input: object) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/team", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not update team");
      if (payload.inviteUrl) { setInviteUrl(payload.inviteUrl); setEmail(""); setCopied(false); }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update team"); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); }
    catch { setError("Copy failed. Select and copy the link manually."); }
  };
  const editableRoles = data?.roles.filter((item) => item.key !== "owner") ?? [];
  return <div className="team-page">
    <section className="panel team-intro"><div className="team-intro-icon"><ShieldCheck /></div><div><span className="eyebrow">WORKSPACE ACCESS</span><h2>People and permissions</h2><p>Invite collaborators to this workspace. Access covers every brand in this workspace; connections managers can add, replace and remove integration credentials without changing team roles or finance settings.</p></div></section>
    {error && <div className="connection-error cost-error" role="alert">{error}</div>}
    {data?.canManageTeam && <section className="panel team-section"><div className="panel-head"><div><span className="eyebrow">INVITE</span><h2>Invite a collaborator</h2><p>Create a seven-day link for a specific email address. Share the link directly with that person.</p></div></div><div className="team-invite-form"><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="colleague@example.com" /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)}>{editableRoles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><button className="primary" disabled={busy || !email.trim()} onClick={() => void mutate("POST", { email, role })}>Create invite link</button></div>{inviteUrl && <div className="team-invite-link"><Link2/><input aria-label="Invitation link" readOnly value={inviteUrl} onFocus={(event) => event.target.select()} /><button onClick={() => void copy()}>{copied ? <Check/> : <Copy/>}{copied ? "Copied" : "Copy"}</button></div>}</section>}
    <section className="panel team-section"><div className="panel-head"><div><span className="eyebrow">MEMBERS</span><h2>Workspace members</h2></div><span className="report-note">{data?.members.length ?? 0} people</span></div>{!data ? <div className="data-loading">Loading team…</div> : <div className="team-list">{data.members.map((member) => <div className="team-member" key={member.user_id}><div className="team-avatar"><Users/></div><div className="team-person"><strong>{member.email || `Member …${member.user_id.slice(-6)}`}</strong><small>{member.user_id === data.userId ? "You · " : ""}Joined {new Date(member.created_at).toLocaleDateString("en-GB")}</small></div>{data.canManageTeam && member.role !== "owner" && member.user_id !== data.userId ? <><select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={(event) => void mutate("PATCH", { userId: member.user_id, role: event.target.value })}>{editableRoles.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select><button className="team-remove" aria-label={`Remove ${member.email}`} disabled={busy} onClick={() => { if (window.confirm(`Remove ${member.email} from this workspace?`)) void mutate("DELETE", { userId: member.user_id }); }}><Trash2/></button></> : <span className="team-role-pill">{data.roles.find((item) => item.key === member.role)?.label || member.role}</span>}</div>)}</div>}</section>
    {data?.canManageTeam && <section className="panel team-section"><div className="panel-head"><div><span className="eyebrow">PENDING</span><h2>Open invitations</h2></div></div>{data.invitations.length ? <div className="team-list">{data.invitations.map((invite) => <div className="team-member" key={invite.id}><div className="team-person"><strong>{invite.email}</strong><small>{data.roles.find((item) => item.key === invite.role)?.label} · Expires {new Date(invite.expires_at).toLocaleDateString("en-GB")}</small></div><button className="team-remove" aria-label={`Revoke invitation for ${invite.email}`} disabled={busy} onClick={() => void mutate("DELETE", { invitationId: invite.id })}><Trash2/></button></div>)}</div> : <p className="team-empty">No open invitations.</p>}</section>}
    <section className="panel team-section"><div className="panel-head"><div><span className="eyebrow">ROLE GUIDE</span><h2>What each role can do</h2></div></div><div className="table-scroll"><table className="data-table team-roles-table"><thead><tr><th>Role</th><th>Reports</th><th>Customer details</th><th>Edit data</th><th>Connections</th><th>Team</th></tr></thead><tbody>{data?.roles.map((item) => <tr key={item.key}><td><strong>{item.label}</strong><small>{item.description}</small></td>{([item.can_view_reports,item.can_view_customer_details,item.can_manage_data,item.can_manage_connections,item.can_manage_team] as boolean[]).map((allowed,index) => <td key={index}><span className={allowed ? "team-yes" : "team-no"}>{allowed ? "✓" : "—"}</span></td>)}</tr>)}</tbody></table></div></section>
  </div>;
}
