"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Clock3, OctagonX, Play, Square } from "lucide-react";
import { useState } from "react";
import type { OrganizerData } from "@/lib/types";
import type { CreateType } from "../dialogs/create-activity-dialog";
import { dateTime, Empty, SectionTitle, SessionCard } from "../components/portal-ui";
import { SessionLifecycleDialog, type SessionLifecycleAction } from "../dialogs/session-lifecycle-dialog";
import { ArchivedOpenPlay } from "./archived-open-play";
import { OpenPlayRoster } from "./open-play-roster";
import { isLiveOpenPlaySession } from "@/lib/open-play";

const sessionAction = (status: string, liveStartedAt?: string | null): SessionLifecycleAction => {
  if (status === "completed" || status === "cancelled") return "archive";
  if (status === "active" && liveStartedAt) return "end";
  return "cancel";
};

export function OpenPlaySection({ data, onCreate, refresh, resourceId, subview }: { data: OrganizerData; onCreate: (type: CreateType) => void; refresh: () => Promise<void>; resourceId?: string; subview?: string }) {
  const router = useRouter();
  const [lifecycle, setLifecycle] = useState<{ action: SessionLifecycleAction; sessionId: string } | null>(null);
  const selectedLifecycleSession = lifecycle ? [...data.sessions, ...data.archivedSessions].find((session) => session.id === lifecycle.sessionId) : null;
  if (resourceId === "archive") return <><ArchivedOpenPlay sessions={data.archivedSessions} onManage={(action, sessionId) => setLifecycle({ action, sessionId })} />{selectedLifecycleSession && lifecycle ? <SessionLifecycleDialog session={selectedLifecycleSession} action={lifecycle.action} onClose={() => setLifecycle(null)} onComplete={async () => { setLifecycle(null); await refresh(); }} /> : null}</>;
  if (resourceId) {
    const session = data.sessions.find((item) => item.id === resourceId);
    if (!session) return <Empty title="Session not found" detail="This session may have been removed or belongs to another venue." />;
    const registrations = data.registrations.filter((item) => item.session_id === resourceId);
    if (subview === "players") return <OpenPlayRoster session={session} registrations={registrations} refresh={refresh} />;
    const action = sessionAction(session.status, session.live_started_at);
    const ActionIcon = action === "cancel" ? OctagonX : action === "end" ? Square : Archive;
    const actionLabel = action === "cancel" ? "Cancel session" : action === "end" ? "End session" : "Archive session";
    const canStart = session.status === "active" && !session.live_started_at;
    const startsEarly = Boolean(session.scheduled_start && new Date(session.scheduled_start) > new Date());
    return <><div className="management-grid"><div className="card management-card"><div className="card-topline"><span className="card-kicker">SESSION MANAGEMENT</span><Link className="text-action" href="/open-play">BACK →</Link></div><h2>{session.name}</h2><p>{session.session_code || "No code"} · {session.court_count || 1} courts · {session.capacity || "—"} capacity</p>{canStart ? <div className={`session-start-note ${startsEarly ? "early" : "ready"}`}><span><Play size={18} /></span><div><strong>{startsEarly ? "Session is scheduled" : "Session is ready to start"}</strong><p>{startsEarly ? "You can prepare the roster now or start early with confirmation." : "Starting opens the live monitor. Matches will still wait for lineup confirmation."}</p></div></div> : null}<div className="venue-facts"><div><strong>{registrations.filter((item) => item.registration_status === "approved").length}</strong><small>APPROVED</small></div><div><strong>{registrations.filter((item) => item.registration_status === "requested").length}</strong><small>NEEDS REVIEW</small></div><div><strong>{registrations.filter((item) => item.registration_status === "waitlisted").length}</strong><small>WAITLISTED</small></div></div><div className="management-actions">{isLiveOpenPlaySession(session) ? <Link className="button button-accent inline-action" href="/monitor">Open monitor</Link> : null}{canStart && startsEarly ? <button className="button button-accent" type="button" disabled><Clock3 size={16} />Starts {dateTime(session.scheduled_start)}</button> : null}{canStart ? <button className={`button ${startsEarly ? "button-ghost" : "button-accent"}`} type="button" onClick={() => setLifecycle({ action: "start", sessionId: session.id })}><Play size={16} />{startsEarly ? "Start early" : "Start session"}</button> : null}<Link className="button button-ghost inline-action" href={`/open-play/${session.id}/players`}>Manage roster</Link><button className="button button-danger" type="button" onClick={() => setLifecycle({ action, sessionId: session.id })}><ActionIcon size={16} />{actionLabel}</button></div></div></div>{selectedLifecycleSession && lifecycle ? <SessionLifecycleDialog session={selectedLifecycleSession} action={lifecycle.action} onClose={() => setLifecycle(null)} onComplete={async () => { const archived = lifecycle.action === "archive"; const started = lifecycle.action === "start"; setLifecycle(null); await refresh(); if (archived) router.push("/open-play"); if (started) router.push("/monitor"); }} /> : null}</>;
  }
  const active = data.sessions.filter((session) => isLiveOpenPlaySession(session));
  const upcoming = data.sessions.filter((session) => (session.status === "active" || session.status === "draft") && !session.live_started_at);
  const recent = data.sessions.filter((session) => session.status === "completed" || session.status === "cancelled");
  return <>
    {active.length ? <><SectionTitle eyebrow="LIVE NOW" title="Active session" /><div className="session-grid">{active.map((session) => <SessionCard key={session.id} session={session} live href="/monitor" manageHref={`/open-play/${session.id}`} />)}</div></> : null}
    <SectionTitle eyebrow="SCHEDULE" title="Upcoming & ready sessions" />
    {upcoming.length ? <div className="session-grid">{upcoming.map((session) => <SessionCard key={session.id} session={session} href={`/open-play/${session.id}`} />)}</div> : <Empty title="Nothing scheduled yet" detail="Create an open-play session with venue, courts, player capacity, and registration rules." action="Create open play" onAction={() => onCreate("session")} />}
    <SectionTitle eyebrow="HISTORY" title="Recent sessions" action="Archived sessions" href="/open-play/archive" />
    {recent.length ? <div className="session-grid">{recent.map((session) => <SessionCard key={session.id} session={session} href={`/open-play/${session.id}`} />)}</div> : <Empty title="No session history yet" detail="Completed and cancelled sessions remain here until you archive them." />}
  </>;
}
