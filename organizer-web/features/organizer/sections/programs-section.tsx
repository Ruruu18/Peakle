"use client";

import "./programs.css";

import { CalendarDays, Clock3, Download, Pencil, Search, TicketCheck, UserCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { canManagePrograms, programCounts, programDateTime, programPhase, programPrice } from "@/lib/program-utils";
import { setProgramParticipantStatus, setProgramStatus } from "@/lib/programs";
import type { OrganizerData, Program, ProgramRegistration, ProgramRegistrationStatus, Venue } from "@/lib/types";
import type { CreateType } from "../dialogs/create-activity-dialog";
import { EditProgramDialog, ProgramConfirmDialog } from "../dialogs/program-dialogs";
import { Empty, Metric, ProfileAvatar, ProgramCard, SelectControl, Status, titleCase } from "../components/portal-ui";

type Props = { data: OrganizerData; venue: Venue | null; onCreate: (type: CreateType) => void; refresh: () => Promise<void>; resourceId?: string };

export function ProgramsSection({ data, venue, onCreate, refresh, resourceId }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const programs = data.programs.filter((item) => !venue || item.venue_id === venue.id);
  const canManage = canManagePrograms(venue);
  if (resourceId) {
    const program = programs.find((item) => item.id === resourceId);
    if (!program) return <Empty title="Program not found" detail="This program may have been removed or belongs to another venue." />;
    return <ProgramManagement key={program.id} program={program} venue={venue} canManage={canManage} refresh={refresh} now={now} />;
  }
  if (!programs.length) return <Empty title="No programs yet" detail={canManage ? "Publish clinics, coaching, or camps for your players." : "Programs published by your venue manager will appear here."} action={canManage ? "Create program" : undefined} onAction={() => onCreate("program")} />;
  const upcoming = programs.filter((program) => !["completed", "cancelled"].includes(programPhase(program, now)));
  const counts = upcoming.reduce((total, program) => { const count = programCounts(program); return { registered: total.registered + count.registered, waitlisted: total.waitlisted + count.waitlisted }; }, { registered: 0, waitlisted: 0 });
  const filtered = programs.filter((program) => {
    const phase = programPhase(program, now);
    const matches = filter === "all" || (filter === "upcoming" ? !["completed", "cancelled"].includes(phase) : phase === filter);
    return matches && `${program.name} ${program.kind}`.toLowerCase().includes(search.trim().toLowerCase());
  }).sort((a, b) => {
    const pastA = ["completed", "cancelled"].includes(programPhase(a, now));
    const pastB = ["completed", "cancelled"].includes(programPhase(b, now));
    if (pastA !== pastB) return Number(pastA) - Number(pastB);
    const difference = new Date(a.starts_at || 0).getTime() - new Date(b.starts_at || 0).getTime();
    return pastA ? -difference : difference;
  });
  return <div className="program-workspace">
    <div className="metric-grid roster-summary"><Metric icon={TicketCheck} value={String(programs.length)} label="Total programs" /><Metric icon={CalendarDays} value={String(upcoming.length)} label="Upcoming & in progress" /><Metric icon={Users} value={String(counts.registered)} label="Registered · active programs" /><Metric icon={Clock3} value={String(counts.waitlisted)} label="Waitlisted · active programs" /></div>
    <div className="program-list-toolbar"><label className="search"><Search size={16} /><input aria-label="Search programs" placeholder="Search programs…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="segmented" aria-label="Filter programs">{[{ value: "all", label: "All programs" }, { value: "upcoming", label: "Upcoming" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }].map((item) => <button key={item.value} className={filter === item.value ? "active" : ""} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div></div>
    {filtered.length ? <div className="program-grid">{filtered.map((program) => <ProgramCard key={program.id} program={program} canManage={canManage} />)}</div> : <Empty title="No matching programs" detail="Try a different name or clear your filters." action="Clear filters" onAction={() => { setSearch(""); setFilter("all"); }} />}
  </div>;
}

function exportRoster(program: Program) {
  const rows = [["Player", "Status", "Registered at (PHT)", "Checked in at (PHT)"], ...(program.program_registrations ?? []).map((item) => [item.profiles?.display_name || "Player", titleCase(item.status), item.created_at ? programDateTime(item.created_at) : "", item.checked_in_at ? programDateTime(item.checked_in_at) : ""])];
  const csv = rows.map((row) => row.map((value) => `"${(/^\s*[=+@-]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${program.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-roster.csv`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast.success("Participant roster exported.");
}

function ProgramManagement({ program, venue, canManage, refresh, now }: { program: Program; venue: Venue | null; canManage: boolean; refresh: () => Promise<void>; now: number }) {
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; detail: string; confirm: string; danger?: boolean; action: () => Promise<void> } | null>(null);
  const phase = programPhase(program, now);
  const cancelled = phase === "cancelled";
  const completed = phase === "completed";
  const started = Boolean(program.starts_at && new Date(program.starts_at).getTime() <= now);
  const editable = canManage && !cancelled && !completed;
  const counts = programCounts(program);
  const registrations = [...(program.program_registrations ?? [])].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const filtered = registrations.filter((item) => (filter === "all" || item.status === filter) && (item.profiles?.display_name || "Player").toLowerCase().includes(search.trim().toLowerCase()));
  const changeStatus = (status: "open" | "closed" | "cancelled") => {
    const copy = status === "cancelled"
      ? { title: "Cancel this program?", detail: `Registration for ${program.name} will close. The participant roster and attendance history will be kept. Contact registered players separately about the change.`, confirm: "Cancel program", danger: true }
      : status === "closed"
        ? { title: "Close registration?", detail: "Players will no longer be able to join. Existing registrations and the waitlist will stay available for you to manage.", confirm: "Close registration" }
        : { title: "Open registration?", detail: "Players can join this program. Once capacity is reached, new registrations go to the waitlist.", confirm: "Open registration" };
    setConfirmation({ ...copy, action: async () => { await setProgramStatus(program, status); toast.success(status === "cancelled" ? "Program cancelled." : `Registration ${status === "open" ? "opened" : "closed"}.`); await refresh(); setConfirmation(null); } });
  };
  const changeParticipant = async (registration: ProgramRegistration, status: ProgramRegistrationStatus) => {
    setBusy(registration.user_id);
    try { await setProgramParticipantStatus(program, registration, status); toast.success("Participant updated."); await refresh(); }
    finally { setBusy(null); }
  };
  const participantAction = (registration: ProgramRegistration, status: ProgramRegistrationStatus) => {
    if (status === "cancelled") {
      setConfirmation({ title: "Cancel this registration?", detail: `${registration.profiles?.display_name || "This player"} will be removed from the active roster. Their registration will remain in the program history.`, confirm: "Cancel registration", danger: true, action: async () => { await changeParticipant(registration, status); setConfirmation(null); } });
    } else void changeParticipant(registration, status).catch((reason) => toast.error(reason instanceof Error ? reason.message : "The participant could not be updated."));
  };
  return <div className="program-workspace">
    <section className="card program-management-header">
      <div className="program-heading-copy"><div className="card-topline"><span className="card-kicker">{titleCase(program.kind)} · {venue?.name || "PROGRAM"}</span><Status value={phase} /></div><h1>{program.name}</h1><p><CalendarDays size={16} />{programDateTime(program.starts_at)} · PHT</p></div>
      {editable ? <div className="program-header-actions"><button className="button button-accent" type="button" onClick={() => setEditing(true)} disabled={Boolean(busy)}><Pencil size={15} />Edit program</button>{program.registration_status === "open" ? <button className="button button-ghost" type="button" onClick={() => changeStatus("closed")} disabled={Boolean(busy)}>Close registration</button> : !started ? <button className="button button-ghost" type="button" onClick={() => changeStatus("open")} disabled={Boolean(busy)}>Open registration</button> : null}</div> : null}
    </section>
    {cancelled ? <div className="notice warning"><strong>Program cancelled</strong><span>Registration is closed. The roster and attendance history are kept for your records.</span></div> : completed ? <div className="program-context-note">This program has ended. You can review the roster and correct attendance records.</div> : !canManage ? <div className="program-context-note">Only venue owners, managers, and platform admins can edit programs and participants.</div> : null}
    <div className="metric-grid roster-summary"><Metric icon={Users} value={`${counts.registered}/${program.capacity || "—"}`} label="Registered players" /><Metric icon={Clock3} value={String(counts.waitlisted)} label="On the waitlist" /><Metric icon={UserCheck} value={String(counts.attended)} label="Attended" /><Metric icon={TicketCheck} value={String(counts.available)} label="Unfilled places" /></div>
    <div className="program-details-grid">
      <section className="card program-details-card"><h2>Program details</h2><dl className="program-facts"><div><dt>Starts · PHT</dt><dd>{programDateTime(program.starts_at)}</dd></div><div><dt>Ends · PHT</dt><dd>{programDateTime(program.ends_at)}</dd></div><div><dt>Skill level</dt><dd>{program.skill_division === "all" || !program.skill_division ? "All skill levels" : titleCase(program.skill_division)}</dd></div><div><dt>Price per player</dt><dd>{program.price ? programPrice(program.price) : "Free"}</dd></div></dl></section>
      <section className="card program-details-card"><h2>About this program</h2><p className="program-description">{program.description || "Add a description with what players will learn, what to bring, and other useful details."}</p>{program.recurrence_rule ? <p className="program-context-note">This program has a recurring schedule. Changes here apply to this program record.</p> : null}{editable ? <button className="text-action program-cancel-action" type="button" disabled={Boolean(busy)} onClick={() => changeStatus("cancelled")}>Cancel program</button> : null}</section>
    </div>
    <section className="roster-panel program-roster">
      <div className="roster-panel-heading"><div><h2>Participants <span className="roster-count">{registrations.length}</span></h2><p>{cancelled ? "Registration history for this cancelled program." : started ? "Manage the waitlist and record player attendance." : "Manage registrations now. Attendance opens when the program starts."}</p></div>{canManage ? <button className="button button-ghost" type="button" disabled={!registrations.length} onClick={() => exportRoster(program)}><Download size={15} />Export roster</button> : null}</div>
      <div className="program-list-toolbar program-roster-toolbar"><label className="search"><Search size={16} /><input aria-label="Search participants" placeholder="Search participants…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><SelectControl ariaLabel="Filter participants" value={filter} onChange={setFilter} options={[{ value: "all", label: "All participants" }, ...(["registered", "waitlisted", "attended", "no_show", "cancelled"] as const).map((value) => ({ value, label: `${titleCase(value)} (${registrations.filter((item) => item.status === value).length})` }))]} /></div>
      {filtered.length ? <div className="program-participants" role="list">{filtered.map((registration) => {
        const name = registration.profiles?.display_name || "Player";
        const writable = canManage && !cancelled;
        const working = busy === registration.user_id;
        return <div className="program-participant" role="listitem" key={registration.user_id} aria-busy={working}>
          <div className="program-participant-person"><ProfileAvatar name={name} photo={registration.profiles?.avatar_url} /><div><strong>{name}</strong><small>{registration.checked_in_at ? `Checked in ${programDateTime(registration.checked_in_at)}` : registration.created_at ? `Joined ${programDateTime(registration.created_at)}` : "Registration date unavailable"}</small></div></div>
          <Status value={registration.status} />
          <div className="program-participant-actions" aria-label={`Actions for ${name}`}>
            {writable && registration.status === "waitlisted" && !completed ? <button className="mini-button" type="button" disabled={Boolean(busy) || counts.available === 0} title={counts.available === 0 ? "Program is full. Increase capacity to admit a player." : "Move this player into a registered place"} onClick={() => participantAction(registration, "registered")}>{working ? "Saving…" : "Admit player"}</button> : null}
            {writable && registration.status === "registered" && started ? <><button className="mini-button" type="button" disabled={Boolean(busy)} onClick={() => participantAction(registration, "attended")}><UserCheck size={14} />{working ? "Saving…" : "Mark attended"}</button><button className="text-action" type="button" disabled={Boolean(busy)} onClick={() => participantAction(registration, "no_show")}>No show</button></> : null}
            {writable && ["attended", "no_show"].includes(registration.status) ? <button className="text-action" type="button" disabled={Boolean(busy)} onClick={() => participantAction(registration, "registered")}>{working ? "Saving…" : "Undo attendance"}</button> : null}
            {writable && !completed && ["registered", "waitlisted"].includes(registration.status) ? <button className="text-action program-cancel-action" type="button" disabled={Boolean(busy)} aria-label={`Cancel registration for ${name}`} onClick={() => participantAction(registration, "cancelled")}>Cancel</button> : null}
          </div>
        </div>;
      })}</div> : <Empty title={registrations.length ? "No matching participants" : "No participants yet"} detail={registrations.length ? "Try another name or registration status." : "Players will appear here when they register for this program."} action={registrations.length ? "Clear filters" : undefined} onAction={() => { setSearch(""); setFilter("all"); }} />}
    </section>
    {editing ? <EditProgramDialog program={program} onClose={() => setEditing(false)} onSaved={async () => { await refresh(); setEditing(false); }} /> : null}
    {confirmation ? <ProgramConfirmDialog {...confirmation} onClose={() => setConfirmation(null)} onConfirm={confirmation.action} /> : null}
  </div>;
}
