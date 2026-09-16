"use client";

import { CalendarDays, CheckCircle2, Clock3, Search, ShieldCheck, UserCheck, Users, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { OpenPlaySession, Registration } from "@/lib/types";
import { requireSupabase } from "@/lib/supabase";
import { useRegistrationActions } from "../hooks/use-registration-actions";
import { dateTime, Empty, Metric, Person, Status, titleCase } from "../components/portal-ui";

export function OpenPlayRoster({ session, registrations: preloaded, refresh, archived }: { session: OpenPlaySession; registrations?: Registration[]; refresh: () => Promise<void>; archived?: boolean }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [archivedRegistrations, setArchivedRegistrations] = useState<Registration[] | null>(null);
  const { act, busyPlayerId } = useRegistrationActions(refresh);

  useEffect(() => {
    if (!archived) return;
    let cancelled = false;
    requireSupabase()
      .from("open_play_players")
      .select("*,profiles!open_play_players_user_id_fkey(display_name,avatar_url)")
      .eq("session_id", session.id)
      .order("joined_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        setArchivedRegistrations(error ? [] : ((data ?? []) as unknown as Registration[]));
      });
    return () => { cancelled = true; };
  }, [archived, session.id]);

  if (archived && archivedRegistrations === null) {
    return <div className="card"><p>Loading roster…</p></div>;
  }

  const registrations = archived ? (archivedRegistrations ?? []) : (preloaded ?? []);
  const approved = registrations.filter((player) => player.registration_status === "approved");
  const requested = registrations.filter((player) => player.registration_status === "requested");
  const waitlisted = registrations.filter((player) => player.registration_status === "waitlisted");
  const checkedIn = registrations.filter((player) => player.checked_in_at);
  const filters = [
    { value: "all", label: "All players", count: registrations.length },
    { value: "requested", label: "Requested", count: requested.length },
    { value: "approved", label: "Approved", count: approved.length },
    { value: "waitlisted", label: "Waitlisted", count: waitlisted.length },
    { value: "checked_in", label: "Checked in", count: checkedIn.length },
  ];
  const visible = registrations.filter((player) => {
    const statusMatch = filter === "all"
      || (filter === "checked_in" ? Boolean(player.checked_in_at) : player.registration_status === filter);
    const name = player.profiles?.display_name || player.guest_name || "";
    return statusMatch && name.toLowerCase().includes(query.trim().toLowerCase());
  });

  return <div className="roster-page">
    <header className="roster-heading">
      <div className="roster-heading-copy">
        <p className="eyebrow">{archived ? "ARCHIVED ROSTER" : "OPEN PLAY ROSTER"}</p>
        <h1>{session.name}</h1>
        <div className="roster-session-meta">
          <span><CalendarDays size={15} aria-hidden="true" />{dateTime(session.scheduled_start)}</span>
          {session.session_code ? <span className="roster-session-code">Code <strong>{session.session_code}</strong></span> : null}
        </div>
      </div>
      <Status value={archived ? "archived" : session.status} />
    </header>

    <div className="metric-grid roster-summary">
      <Metric icon={Users} value={`${approved.length}/${session.capacity || "—"}`} label="Approved slots" />
      <Metric icon={ShieldCheck} value={String(requested.length)} label="Needs review" />
      <Metric icon={Clock3} value={String(waitlisted.length)} label="Waitlisted" />
      <Metric icon={UserCheck} value={String(checkedIn.length)} label="Checked in" />
    </div>

    <section className="roster-panel" aria-labelledby="roster-players-heading">
      <div className="roster-panel-heading">
        <div>
          <h2 id="roster-players-heading">Player roster <span className="roster-count">{registrations.length}</span></h2>
          <p>{archived ? "Registration and attendance history for this session." : "Review registration requests and track attendance."}</p>
        </div>
        {!archived && requested.length > 0 ? <button className="button button-accent roster-review-button" type="button" onClick={() => { setQuery(""); setFilter("requested"); }}><ShieldCheck size={16} aria-hidden="true" />Review requests <span>{requested.length}</span></button> : null}
      </div>

      <div className="toolbar roster-toolbar">
        <div className="search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players…" aria-label="Search this session roster" />
        </div>
        <div className="segmented" role="group" aria-label="Filter roster by status">
          {filters.map(({ value, label, count }) => <button key={value} className={filter === value ? "active" : ""} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span className="roster-filter-count">{count}</span></button>)}
        </div>
      </div>

      {visible.length ? <div className="table-card roster-table-card">
        <table className="data-table mobile-card-table player-table" aria-labelledby="roster-players-heading">
          <thead><tr><th scope="col">PLAYER</th><th scope="col">RATING</th><th scope="col">REGISTRATION</th><th scope="col">JOINED</th><th scope="col">ATTENDANCE</th>{archived ? null : <th scope="col" className="roster-actions-heading">ACTIONS</th>}</tr></thead>
          <tbody>{visible.map((player) => <tr key={player.id}>
            <td data-label="Player" className="mobile-primary-cell"><Person registration={player} /></td>
            <td data-label="Rating" className="roster-rating">{player.profiles?.skill_rating?.toFixed(1) || "—"}</td>
            <td data-label="Registration"><Status value={player.registration_status || "requested"} /></td>
            <td data-label="Joined" className="roster-joined">{dateTime(player.joined_at)}</td>
            <td data-label="Attendance"><span className={`roster-attendance${player.checked_in_at ? " is-checked-in" : ""}`}>{player.checked_in_at ? <CheckCircle2 size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}{player.checked_in_at ? "Checked in" : "Not checked in"}</span></td>
            {archived ? null : <td data-label="Actions" className="mobile-action-cell"><RegistrationActions player={player} busy={busyPlayerId === player.id} act={act} /></td>}
          </tr>)}</tbody>
        </table>
      </div> : <Empty title={registrations.length ? "No matching players" : "No registrations yet"} detail={registrations.length ? "Try another name or status to find the player you need." : "Players will appear here when they register for this open play."} action={registrations.length ? "Clear filters" : undefined} onAction={() => { setQuery(""); setFilter("all"); }} />}

      <div className="roster-panel-footer" role="status">Showing {visible.length} of {registrations.length} {registrations.length === 1 ? "player" : "players"}</div>
    </section>
  </div>;
}

function RegistrationActions({ player, busy, act }: { player: Registration; busy: boolean; act: ReturnType<typeof useRegistrationActions>["act"] }) {
  if (player.registration_status === "requested") return <div className="row-actions"><button className="mini-button" type="button" disabled={busy} onClick={() => void act(player, "approve")}><CheckCircle2 size={14} />Approve</button><button className="mini-button danger" type="button" disabled={busy} onClick={() => void act(player, "reject")}><XCircle size={14} />Decline</button></div>;
  if (player.registration_status === "approved" && !player.checked_in_at) return <div className="row-actions"><button className="mini-button" type="button" disabled={busy} onClick={() => void act(player, "checkin")}>Check in</button></div>;
  if (player.checked_in_at) return <span className="roster-no-action" aria-label="No action needed">—</span>;
  return <span className="table-secondary">{titleCase(player.registration_status || "registered")}</span>;
}
