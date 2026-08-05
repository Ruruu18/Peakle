"use client";

import Link from "next/link";
import { Activity, Eye, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { OrganizerData, Venue } from "@/lib/types";
import { Empty, Metric, Person, SectionTitle, SelectControl, Status, dateOnly, titleCase } from "../components/portal-ui";

const roleDescription = (role: string) => ({ owner: "Full venue and account control", manager: "Venue, staff, sessions, and reports", front_desk: "Registration, check-in, and bookings", court_monitor: "Live courts, queue, and rotations", scorer: "Live scores and match results", viewer: "Read-only venue operations", admin: "Full platform control" } as Record<string, string>)[role] || "Custom venue access";

export function StaffSection({ data, venue, refresh, subview }: { data: OrganizerData; venue: Venue | null; refresh: () => Promise<void>; subview?: string }) {
  if (!venue) return <Empty title="No managed venue" detail="Staff access becomes available after a venue is added." />;
  if (subview === "invite") return <InviteStaff venue={venue} />;
  const changeRole = async (userId: string, role: string) => {
    try {
      const { error } = await requireSupabase().rpc("set_venue_staff_role", { p_venue_id: venue.id, p_user_id: userId, p_role: role });
      if (error) throw error;
      await refresh();
      toast.success("Staff permissions updated.");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Role update failed."); }
  };
  return <>
    <div className="metric-grid"><Metric icon={Users} value={String(data.staff.length)} label="TEAM MEMBERS" /><Metric icon={ShieldCheck} value={String(data.staff.filter((item) => ["owner", "manager", "admin"].includes(item.role)).length)} label="MANAGERS" /><Metric icon={Activity} value={String(data.staff.filter((item) => item.role === "court_monitor").length)} label="COURT MONITORS" /><Metric icon={Eye} value={String(data.staff.filter((item) => item.role === "viewer").length)} label="VIEW ONLY" /></div>
    <SectionTitle eyebrow="ACCESS ROSTER" title={venue.name} action="Invite staff" href="/staff/invite" />
    <div className="table-card"><table className="data-table mobile-card-table staff-table"><thead><tr><th>TEAM MEMBER</th><th>ROLE</th><th>ACCESS</th><th>ADDED</th></tr></thead><tbody>{data.staff.map((member) => <tr key={member.user_id}><td data-label="Team member" className="mobile-primary-cell"><Person name={member.profiles?.display_name || "Venue staff"} /></td><td data-label="Role">{member.role === "owner" ? <Status value="owner" /> : <SelectControl className="compact-select" value={member.role} onChange={(role) => changeRole(member.user_id, role)} ariaLabel={`Role for ${member.profiles?.display_name || "staff"}`} options={["manager", "front_desk", "court_monitor", "scorer", "viewer"].map((role) => ({ value: role, label: titleCase(role) }))} />}</td><td data-label="Access" className="table-secondary">{roleDescription(member.role)}</td><td data-label="Added">{member.created_at ? dateOnly(member.created_at) : "Original team"}</td></tr>)}</tbody></table></div>
  </>;
}

function InviteStaff({ venue }: { venue: Venue }) {
  return <div className="management-grid"><div className="card management-card"><div className="card-topline"><span className="card-kicker">STAFF ACCESS</span><Link className="text-action" href="/staff">BACK →</Link></div><h2>Invite staff</h2><p>{venue.name}</p><div className="notice"><strong>Invite by Peakle account</strong><span>Ask the team member to create a Peakle account, then assign their role from the staff roster. Direct email invitations require the Supabase email hook to be configured.</span></div><a className="button button-accent inline-action" href="mailto:?subject=Join%20our%20Peakle%20venue&body=Create%20your%20Peakle%20account%20and%20send%20me%20the%20email%20you%20used.">Send invite instructions</a></div></div>;
}
