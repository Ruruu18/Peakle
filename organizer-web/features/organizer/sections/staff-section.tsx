"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Eye, Search, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { OrganizerData, Venue } from "@/lib/types";
import { Empty, Metric, Person, SectionTitle, SelectControl, Status, dateOnly, titleCase } from "../components/portal-ui";

const roleDescription = (role: string) => ({ owner: "Full venue and account control", manager: "Venue, staff, sessions, and reports", front_desk: "Registration, check-in, and bookings", court_monitor: "Live courts, queue, and rotations", scorer: "Live scores and match results", viewer: "Read-only venue operations", admin: "Full platform control" } as Record<string, string>)[role] || "Custom venue access";
const invitableRoles = ["manager", "front_desk", "court_monitor", "scorer", "viewer"];

export function StaffSection({ data, venue, refresh, subview }: { data: OrganizerData; venue: Venue | null; refresh: () => Promise<void>; subview?: string }) {
  if (!venue) return <Empty title="No managed venue" detail="Staff access becomes available after a venue is added." />;
  if (subview === "add") return <AddStaff venue={venue} refresh={refresh} />;
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
    <SectionTitle eyebrow="ACCESS ROSTER" title={venue.name} />
    <div className="table-card"><table className="data-table mobile-card-table staff-table"><thead><tr><th>TEAM MEMBER</th><th>ROLE</th><th>ACCESS</th><th>ADDED</th></tr></thead><tbody>{data.staff.map((member) => <tr key={member.user_id}><td data-label="Team member" className="mobile-primary-cell"><Person name={member.profiles?.display_name || "Venue staff"} /></td><td data-label="Role">{member.role === "owner" ? <Status value="owner" /> : <SelectControl className="compact-select" value={member.role} onChange={(role) => changeRole(member.user_id, role)} ariaLabel={`Role for ${member.profiles?.display_name || "staff"}`} options={["manager", "front_desk", "court_monitor", "scorer", "viewer"].map((role) => ({ value: role, label: titleCase(role) }))} />}</td><td data-label="Access" className="table-secondary">{roleDescription(member.role)}</td><td data-label="Added">{member.created_at ? dateOnly(member.created_at) : "Original team"}</td></tr>)}</tbody></table></div>
  </>;
}

type Candidate = { user_id: string; display_name: string; already_staff: boolean };

function AddStaff({ venue, refresh }: { venue: Venue; refresh: () => Promise<void> }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [searched, setSearched] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [role, setRole] = useState("front_desk");
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setSearching(true);
    setCandidate(null);
    try {
      const { data, error } = await requireSupabase().rpc("find_staff_candidate_by_email", { p_venue_id: venue.id, p_email: email.trim() });
      if (error) throw error;
      const match = Array.isArray(data) ? data[0] : data;
      setCandidate(match ? { user_id: match.user_id, display_name: match.display_name, already_staff: match.already_staff } : null);
      setSearched(true);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Could not search for that account."); }
    finally { setSearching(false); }
  };

  const addToTeam = async () => {
    if (!candidate) return;
    setAdding(true);
    try {
      const { error } = await requireSupabase().rpc("set_venue_staff_role", { p_venue_id: venue.id, p_user_id: candidate.user_id, p_role: role });
      if (error) throw error;
      await refresh();
      toast.success(`${candidate.display_name} added to your team.`);
      router.replace("/staff");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Could not add this teammate."); }
    finally { setAdding(false); }
  };

  return <div className="management-grid"><div className="card management-card">
    <form onSubmit={search} className="form-field"><label htmlFor="staff-email">TEAMMATE&apos;S EMAIL</label><input id="staff-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setSearched(false); setCandidate(null); }} placeholder="name@email.com" required /><button className="button button-accent inline-action" type="submit" disabled={searching || !email.trim()}><Search size={15} /> {searching ? "Searching…" : "Find their account"}</button></form>

    {searched && candidate && !candidate.already_staff ? <div className="notice"><strong>Found {candidate.display_name}</strong><span>Choose their role and add them to {venue.name}.</span><div className="form-field"><label>ROLE</label><SelectControl value={role} onChange={setRole} ariaLabel="Staff role" options={invitableRoles.map((item) => ({ value: item, label: titleCase(item) }))} /></div><button className="button button-accent inline-action" type="button" onClick={addToTeam} disabled={adding}><UserPlus size={15} /> {adding ? "Adding…" : `Add as ${titleCase(role)}`}</button></div> : null}

    {searched && candidate?.already_staff ? <div className="notice"><strong>Already on your team</strong><span>{candidate.display_name} already has access. Manage their role from the staff roster.</span></div> : null}

    {searched && !candidate ? <div className="notice warning"><strong>No Peakle account found for that email</strong><span>Ask them to create a Peakle account first, then search again once they&apos;ve signed up — you&apos;ll be able to add them here right away.</span><a className="button button-ghost inline-action" href={`mailto:${encodeURIComponent(email)}?subject=Join%20our%20Peakle%20venue&body=Create%20your%20Peakle%20account%2C%20then%20let%20me%20know%20once%20you%27re%20signed%20up%20so%20I%20can%20add%20you%20to%20the%20team.`}>Send invite instructions</a></div> : null}
  </div></div>;
}
