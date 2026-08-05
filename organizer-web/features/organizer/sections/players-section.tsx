"use client";

import { CheckCircle2, Clock3, Search, ShieldCheck, UserCheck, Users, XCircle } from "lucide-react";
import { useState } from "react";
import type { OrganizerData } from "@/lib/types";
import { Metric, Person, SectionTitle, Status, titleCase } from "../components/portal-ui";
import { useRegistrationActions } from "../hooks/use-registration-actions";

export function PlayersSection({ data, refresh }: { data: OrganizerData; refresh: () => Promise<void> }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const { act, busyPlayerId } = useRegistrationActions(refresh);
  const currentRegistrations = data.registrations.filter((player) => !["cancelled", "rejected"].includes(player.registration_status || ""));
  const players = data.registrations.filter((player) => {
    const matchesFilter = filter === "all" || (filter === "checked_in" ? Boolean(player.checked_in_at) : player.registration_status === filter);
    const name = player.profiles?.display_name || player.guest_name || "";
    return matchesFilter && name.toLowerCase().includes(query.toLowerCase());
  });
  return <>
    <div className="metric-grid">
      <Metric icon={Users} value={String(currentRegistrations.length)} label="CURRENT REGISTRATIONS" />
      <Metric icon={UserCheck} value={String(data.registrations.filter((item) => item.registration_status === "approved").length)} label="APPROVED" />
      <Metric icon={Clock3} value={String(data.registrations.filter((item) => item.registration_status === "waitlisted").length)} label="WAITLISTED" />
      <Metric icon={ShieldCheck} value={String(data.registrations.filter((item) => item.registration_status === "requested").length)} label="NEEDS REVIEW" />
    </div>
    <SectionTitle eyebrow="SESSION ROSTER" title="Registration and attendance" />
    <div className="toolbar"><div className="search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players" aria-label="Search players" /></div><div className="segmented">{["all", "requested", "approved", "waitlisted", "checked_in"].map((value) => <button key={value} className={filter === value ? "active" : ""} type="button" onClick={() => setFilter(value)}>{titleCase(value)}</button>)}</div></div>
    <div className="table-card"><table className="data-table mobile-card-table player-table"><thead><tr><th>PLAYER</th><th>SESSION</th><th>RATING</th><th>REGISTRATION</th><th>PLAY STATUS</th><th>ACTION</th></tr></thead><tbody>{players.map((player) => { const session = data.sessions.find((item) => item.id === player.session_id); const busy = busyPlayerId === player.id; return <tr key={player.id}><td data-label="Player" className="mobile-primary-cell"><Person registration={player} /></td><td data-label="Session"><span className="table-primary">{session?.name || "Open Play"}</span></td><td data-label="Rating">{player.profiles?.skill_rating?.toFixed(1) || "—"}</td><td data-label="Registration"><Status value={player.registration_status || "requested"} /></td><td data-label="Play status"><Status value={player.checked_in_at ? player.status || "checked_in" : "not_checked_in"} /></td><td data-label="Next step" className="mobile-action-cell"><div className="row-actions">{player.registration_status === "requested" ? <><button className="mini-button" type="button" disabled={busy} onClick={() => void act(player, "approve")}><CheckCircle2 size={14} />Approve</button><button className="mini-button danger" type="button" disabled={busy} onClick={() => void act(player, "reject")}><XCircle size={14} />Decline</button></> : player.registration_status === "approved" && !player.checked_in_at ? <button className="mini-button" type="button" disabled={busy} onClick={() => void act(player, "checkin")}>Check in</button> : <span className="table-secondary">{player.checked_in_at ? "Checked in" : titleCase(player.registration_status)}</span>}</div></td></tr>; })}</tbody></table></div>
  </>;
}
