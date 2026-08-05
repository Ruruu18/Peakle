"use client";

import Link from "next/link";
import { CheckCircle2, Clock3, Search, ShieldCheck, UserCheck, Users, XCircle } from "lucide-react";
import { useState } from "react";
import type { OpenPlaySession, Registration } from "@/lib/types";
import { useRegistrationActions } from "../hooks/use-registration-actions";
import { dateTime, Empty, Metric, Person, Status, titleCase } from "../components/portal-ui";

export function OpenPlayRoster({ session, registrations, refresh }: { session: OpenPlaySession; registrations: Registration[]; refresh: () => Promise<void> }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const { act, busyPlayerId } = useRegistrationActions(refresh);
  const approved = registrations.filter((player) => player.registration_status === "approved");
  const requested = registrations.filter((player) => player.registration_status === "requested");
  const waitlisted = registrations.filter((player) => player.registration_status === "waitlisted");
  const visible = registrations.filter((player) => {
    const statusMatch = filter === "all"
      || (filter === "checked_in" ? Boolean(player.checked_in_at) : player.registration_status === filter);
    const name = player.profiles?.display_name || player.guest_name || "";
    return statusMatch && name.toLowerCase().includes(query.trim().toLowerCase());
  });

  return <>
    <div className="section-command-bar roster-command-bar">
      <div><p className="eyebrow">SESSION ROSTER</p><h2>{session.name}</h2><p>{dateTime(session.scheduled_start)} · {registrations.length} registration records</p></div>
      <div><Link className="button button-ghost inline-action" href={`/open-play/${session.id}`}>Back to session</Link></div>
    </div>
    <div className="metric-grid roster-metrics">
      <Metric icon={Users} value={`${approved.length}/${session.capacity || "—"}`} label="APPROVED SLOTS" />
      <Metric icon={ShieldCheck} value={String(requested.length)} label="NEEDS REVIEW" />
      <Metric icon={Clock3} value={String(waitlisted.length)} label="WAITLISTED" />
      <Metric icon={UserCheck} value={String(registrations.filter((player) => player.checked_in_at).length)} label="CHECKED IN" />
    </div>
    <div className="toolbar roster-toolbar"><div className="search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this roster" aria-label="Search this session roster" /></div><div className="segmented">{["all", "requested", "approved", "waitlisted", "checked_in"].map((value) => <button key={value} className={filter === value ? "active" : ""} type="button" onClick={() => setFilter(value)}>{titleCase(value)}</button>)}</div></div>
    {visible.length ? <div className="table-card"><table className="data-table mobile-card-table player-table"><thead><tr><th>PLAYER</th><th>RATING</th><th>REGISTRATION</th><th>JOINED</th><th>ATTENDANCE</th><th>ACTION</th></tr></thead><tbody>{visible.map((player) => {
      const busy = busyPlayerId === player.id;
      return <tr key={player.id}><td data-label="Player" className="mobile-primary-cell"><Person registration={player} /></td><td data-label="Rating">{player.profiles?.skill_rating?.toFixed(1) || "—"}</td><td data-label="Registration"><Status value={player.registration_status || "requested"} /></td><td data-label="Joined">{dateTime(player.joined_at)}</td><td data-label="Attendance"><Status value={player.checked_in_at ? "checked_in" : "not_checked_in"} /></td><td data-label="Next step" className="mobile-action-cell"><RegistrationActions player={player} busy={busy} act={act} /></td></tr>;
    })}</tbody></table></div> : <Empty title="No matching registrations" detail={registrations.length ? "Change the search or status filter to see other players." : "Players who join this Open Play from the mobile app will appear here automatically."} />}
  </>;
}

function RegistrationActions({ player, busy, act }: { player: Registration; busy: boolean; act: ReturnType<typeof useRegistrationActions>["act"] }) {
  if (player.registration_status === "requested") return <div className="row-actions"><button className="mini-button" type="button" disabled={busy} onClick={() => void act(player, "approve")}><CheckCircle2 size={14} />Approve</button><button className="mini-button danger" type="button" disabled={busy} onClick={() => void act(player, "reject")}><XCircle size={14} />Decline</button></div>;
  if (player.registration_status === "approved" && !player.checked_in_at) return <div className="row-actions"><button className="mini-button" type="button" disabled={busy} onClick={() => void act(player, "checkin")}>Check in</button></div>;
  if (player.checked_in_at) return <span className="table-secondary">Checked in</span>;
  return <span className="table-secondary">{titleCase(player.registration_status || "registered")}</span>;
}
