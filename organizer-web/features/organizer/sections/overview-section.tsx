"use client";

import { Activity, BarChart3, CalendarDays, CircleDollarSign, Grid2X2, TicketCheck, Trophy, UserCheck, Users } from "lucide-react";
import type { OrganizerData, Venue } from "@/lib/types";
import type { PortalSection } from "@/lib/portal-sections";
import type { CreateType } from "../dialogs/create-activity-dialog";
import { ActivityRow, Empty, LiveSession, Metric, Quick, SectionTitle, isCourtScoring, money } from "../components/portal-ui";
import { isLiveOpenPlaySession, registrationsForSession } from "@/lib/open-play";

export function OverviewSection({ data, venue, navigate, onCreate }: { data: OrganizerData; venue: Venue | null; navigate: (section: PortalSection) => void; onCreate: (type: CreateType) => void }) {
  const active = data.sessions.find((session) => isLiveOpenPlaySession(session));
  const activeRegistrations = registrationsForSession(data.registrations, active?.id);
  const checkedIn = activeRegistrations.filter((player) => player.checked_in_at).length;
  const activeCourts = data.liveCourts.filter((court) => isCourtScoring(court)).length;
  const activeSessionCourts = data.liveCourts.filter((court) => court.session_id === active?.id && isCourtScoring(court)).length;
  const pending = activeRegistrations.filter((player) => player.registration_status === "requested").length;
  return <>
    <div className="metric-grid">
      <Metric icon={Users} value={String(checkedIn)} label="PLAYERS CHECKED IN" trend={`${pending} pending`} highlight />
      <Metric icon={Activity} value={`${activeCourts}/${Math.max(data.liveCourts.length, venue?.courts.length || 0)}`} label="COURTS IN PLAY" trend={activeCourts > 0 ? "Live" : undefined} />
      <Metric icon={CalendarDays} value={String(data.sessions.filter((session) => session.status === "active" && !session.live_started_at).length)} label="UPCOMING SESSIONS" trend="Ready when you are" />
      <Metric icon={CircleDollarSign} value={money(data.analytics?.grossRevenue)} label="30-DAY REVENUE" trend={`${data.analytics?.courtUtilization || 0}% util.`} />
    </div>
    <SectionTitle eyebrow="HAPPENING NOW" title="Today at your venue" />
    <div className="dashboard-grid">
      {active ? <LiveSession session={active} playerCount={activeRegistrations.length} activeCourts={activeSessionCourts} onOpen={() => navigate("monitor")} /> : <Empty title="No live session" detail="Start a published session from Open Play when your venue and courts are ready." action="Create open play" onAction={() => onCreate("session")} />}
      <div className="card activity-list">
        <ActivityRow icon={UserCheck} title={`${checkedIn} ${checkedIn === 1 ? "player" : "players"} checked in`} detail={active?.name || "No active session"} status={active ? (activeSessionCourts > 0 ? "live" : "open") : "closed"} />
        <ActivityRow icon={Trophy} title={`${data.competitions.length} ${data.competitions.length === 1 ? "competition" : "competitions"}`} detail="Brackets and registration" status="active" />
        <ActivityRow icon={TicketCheck} title={`${data.programs.length} ${data.programs.length === 1 ? "program" : "programs"}`} detail="Clinics and coaching" status="open" />
      </div>
    </div>
    <SectionTitle eyebrow="SHORTCUTS" title="Move quickly" />
    <div className="quick-grid">
      <Quick icon={CalendarDays} title="Create open play" detail="Publish a court-ready session." onClick={() => onCreate("session")} />
      <Quick icon={UserCheck} title="Manage players" detail="Approve and check players in." onClick={() => navigate("players")} />
      <Quick icon={Grid2X2} title="Open monitor" detail="Watch courts and the queue." onClick={() => navigate("monitor")} />
      <Quick icon={BarChart3} title="Venue analytics" detail="See utilization and revenue." onClick={() => navigate("analytics")} />
    </div>
  </>;
}
