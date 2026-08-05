"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Clock3, Eye, Maximize2, Minimize2, Play, Radio, RotateCcw, Settings2, Trophy, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { OpenPlayMatch, OpenPlaySession, OrganizerData, Registration } from "@/lib/types";
import { isLiveOpenPlaySession, registrationsForSession } from "@/lib/open-play";
import { activeMatch, Empty, Person, SectionTitle, SelectControl, Status, titleCase } from "../components/portal-ui";
import { SessionLifecycleDialog } from "../dialogs/session-lifecycle-dialog";

const playerName = (lineup: NonNullable<OpenPlayMatch["open_play_match_players"]>[number]) =>
  lineup.open_play_players?.profiles?.display_name || lineup.open_play_players?.guest_name || "Guest player";

const sortQueue = (players: Registration[]) => [...players].sort((a, b) =>
  Number(a.queue_position ?? Number.MAX_SAFE_INTEGER) - Number(b.queue_position ?? Number.MAX_SAFE_INTEGER)
  || new Date(a.waiting_since || a.checked_in_at || a.joined_at || 0).getTime() - new Date(b.waiting_since || b.checked_in_at || b.joined_at || 0).getTime()
);

function OpenCourtCard({ court, queue, sessionId, refresh }: {
  court: OrganizerData["liveCourts"][number];
  queue: Registration[];
  sessionId: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const expectedPlayers = court.match_format === "singles" ? 2 : 4;
  const recommended = queue.slice(0, expectedPlayers);
  const missing = expectedPlayers - recommended.length;
  const scorer = recommended.find((player) => Boolean(player.user_id));

  const assign = async () => {
    if (missing > 0 || !scorer || busy) return;
    setBusy(true);
    try {
      const ids = recommended.map((player) => player.id);
      const { error } = await requireSupabase().rpc("assign_fair_play_match", {
        p_session_id: sessionId,
        p_court_id: court.id,
        p_match_id: globalThis.crypto.randomUUID(),
        p_player_ids: ids,
        p_scorer_player_id: scorer.id,
        p_explanation: {
          reason: "Longest-waiting available players were assigned next.",
          queue_positions: recommended.map((player) => Number(player.queue_position ?? 0) + 1),
        },
        p_recommended_ids: ids,
        p_override_reason: null,
      });
      if (error) throw error;
      toast.success(`${court.venue_court?.name || `Court ${court.court_number}`} is live. Players were notified.`);
      await refresh();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "The lineup could not be assigned.");
    } finally { setBusy(false); }
  };

  return <article className="card court-card court-operation-card">
    <div className="court-card-head"><span className="court-number">{court.court_number || "–"}</span><div><h3>{court.venue_court?.name || `Court ${court.court_number}`}</h3><p>{titleCase(court.match_format || "doubles")}</p></div><Status value="open" /></div>
    <div className="next-lineup">
      <div className="next-lineup-head"><span>NEXT FAIR LINEUP</span><strong>{recommended.length}/{expectedPlayers}</strong></div>
      {recommended.length ? <div className="lineup-chips">{recommended.map((player, index) => <span key={player.id}><b>{index + 1}</b>{player.profiles?.display_name || player.guest_name || "Guest player"}</span>)}</div> : <p>No checked-in players are waiting yet.</p>}
    </div>
    {missing > 0 ? <div className="court-action-note"><Users size={15} /><span>Check in {missing} more player{missing === 1 ? "" : "s"} to start this {court.match_format === "singles" ? "singles" : "doubles"} match.</span></div> : !scorer ? <div className="court-action-note"><Users size={15} /><span>Add at least one signed-in Peakle player so the match has a player scorer.</span></div> : <div className="court-action-note ready"><Check size={15} /><span>{scorer.profiles?.display_name || scorer.guest_name || "The first signed-in player"} will score from the player app.</span></div>}
    <button className="button button-accent court-primary-action" type="button" disabled={busy || missing > 0 || !scorer} onClick={() => void assign()}><Play size={15} />{busy ? "Starting match…" : "Assign & send to court"}</button>
  </article>;
}

function LiveCourtCard({ court, match }: {
  court: OrganizerData["liveCourts"][number];
  match: OpenPlayMatch;
}) {
  const scores: [number, number] = [Number(match.home_score || 0), Number(match.away_score || 0)];
  const lineup = [...(match.open_play_match_players || [])].sort((a, b) => a.side - b.side || a.position - b.position);
  const sides = [lineup.filter((player) => player.side === 0), lineup.filter((player) => player.side === 1)];
  const scorer = lineup.find((player) => player.player_id === match.scorer_player_id);

  return <article className="card court-card court-operation-card live-court-card">
    <div className="court-card-head"><span className="court-number">{court.court_number || "–"}</span><div><h3>{court.venue_court?.name || `Court ${court.court_number}`}</h3><p>{titleCase(court.match_format || "doubles")} · live now</p></div><Status value="playing" /></div>
    <div className="live-lineup"><div><span>HOME</span><strong>{sides[0].map(playerName).join(" + ") || "Players"}</strong></div><div><span>AWAY</span><strong>{sides[1].map(playerName).join(" + ") || "Players"}</strong></div></div>
    <div className="organizer-live-score"><div><span>HOME</span><strong>{scores[0]}</strong></div><i>—</i><div><span>AWAY</span><strong>{scores[1]}</strong></div></div>
    <div className="player-scoring-note"><Eye size={15} /><span><strong>{scorer ? playerName(scorer) : "Assigned player"}</strong> is scoring from the player app. This monitor updates automatically.</span></div>
  </article>;
}

type MonitorTab = "status" | "matchups" | "controls";
type FormatFilter = "all" | "singles" | "doubles";

const elapsedTime = (startedAt: string | null | undefined, now: number) => {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

function ZoomCourtCard({ court, now, queue }: { court: OrganizerData["liveCourts"][number]; now: number; queue: Registration[] }) {
  const match = activeMatch(court);
  const lineup = [...(match?.open_play_match_players || [])].sort((a, b) => a.side - b.side || a.position - b.position);
  const home = lineup.filter((player) => player.side === 0).map(playerName).join(" + ") || "Waiting for lineup";
  const away = lineup.filter((player) => player.side === 1).map(playerName).join(" + ") || "Waiting for lineup";
  const needed = court.match_format === "singles" ? 2 : 4;
  const nextNames = queue.slice(0, needed).map((player) => player.profiles?.display_name || player.guest_name || "Guest player");

  return <article className={`zoom-court-card ${match ? "is-live" : "is-open"}`}>
    <div className="zoom-court-head"><div><span>COURT {court.court_number || "–"}</span><h3>{court.venue_court?.name || `Court ${court.court_number}`}</h3></div><span className={`zoom-court-state ${match ? "live" : "open"}`}>{match ? <><i className="live-dot" />LIVE</> : "OPEN"}</span></div>
    {match ? <>
      <div className="zoom-match-time"><Clock3 size={15} /><span>Match time</span><strong>{elapsedTime(match.started_at, now)}</strong></div>
      <div className="zoom-score"><div><small>HOME</small><strong>{Number(match.home_score || 0)}</strong><span>{home}</span></div><b>—</b><div><small>AWAY</small><strong>{Number(match.away_score || 0)}</strong><span>{away}</span></div></div>
    </> : <div className="zoom-open-court"><span><RotateCcw size={22} /></span><div><small>NEXT FAIR LINEUP</small><strong>{nextNames.length === needed ? nextNames.join(" · ") : `Waiting for ${needed - nextNames.length} more player${needed - nextNames.length === 1 ? "" : "s"}`}</strong></div></div>}
    <div className="zoom-court-foot"><span>{titleCase(court.match_format || "doubles")}</span><small>{match ? "Scores update automatically" : "Ready for the next rotation"}</small></div>
  </article>;
}

function ZoomMonitor({ data, session, queue, venueId, onVenueChange, onClose, onEnd }: { data: OrganizerData; session: OpenPlaySession; queue: Registration[]; venueId: string | null; onVenueChange: (venueId: string | null) => void; onClose: () => void; onEnd: () => void }) {
  const [format, setFormat] = useState<FormatFilter>("all");
  const [tab, setTab] = useState<MonitorTab>("status");
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const courts = useMemo(() => data.liveCourts.filter((court) => format === "all" || court.match_format === format), [data.liveCourts, format]);
  const pageCount = Math.max(1, Math.ceil(courts.length / 4));
  const safePage = Math.min(page, pageCount - 1);
  const visibleCourts = courts.slice(safePage * 4, safePage * 4 + 4);
  const liveCourts = courts.filter((court) => Boolean(activeMatch(court)));

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const updates = courts.map((court) => {
    const match = activeMatch(court);
    const label = court.venue_court?.name || `Court ${court.court_number}`;
    if (!match) return { id: court.id, tone: "open", title: `${label} is open`, detail: "Ready to receive the next fair lineup.", time: "NOW" };
    const lineup = [...(match.open_play_match_players || [])].sort((a, b) => a.side - b.side || a.position - b.position);
    const home = lineup.filter((player) => player.side === 0).map(playerName).join(" + ") || "Home";
    const away = lineup.filter((player) => player.side === 1).map(playerName).join(" + ") || "Away";
    return { id: court.id, tone: "live", title: `${label} is live`, detail: `${home} vs ${away} · ${match.home_score || 0}–${match.away_score || 0}`, time: elapsedTime(match.started_at, now) };
  });

  return <div className="monitor-zoom" role="dialog" aria-modal="true" aria-label="Expanded live court monitor">
    <header className="monitor-zoom-header"><div className="monitor-zoom-brand"><span><Radio size={18} /></span><div><p>PEAKLE · LIVE MONITOR</p><h2>{session.name}</h2></div></div><div className="monitor-zoom-venue"><SelectControl value={venueId || data.venues[0]?.id || ""} options={data.venues.map((venue) => ({ value: venue.id, label: venue.name, detail: venue.area || "Organizer venue" }))} onChange={(value) => { setPage(0); onVenueChange(value || null); }} ariaLabel="Monitor venue" disabled={!data.venues.length} /></div><div className="monitor-format-switch" aria-label="Court format filter">{(["all", "singles", "doubles"] as FormatFilter[]).map((value) => <button key={value} className={format === value ? "active" : ""} type="button" aria-pressed={format === value} onClick={() => { setPage(0); setFormat(value); }}>{value === "all" ? "All courts" : titleCase(value)}</button>)}</div><button className="monitor-zoom-close" type="button" aria-label="Exit expanded monitor" onClick={onClose}><Minimize2 size={19} /><span>Exit</span></button></header>
    <div className="monitor-zoom-body">
      <section className="monitor-zoom-courts" aria-label="Live courts"><div className="monitor-zoom-section-head"><div><p>COURT SCOREBOARDS</p><h2>{format === "all" ? "All live courts" : `${titleCase(format)} courts`}</h2></div><div className="monitor-court-pager"><span>{courts.length ? `${safePage * 4 + 1}–${Math.min(safePage * 4 + 4, courts.length)} of ${courts.length}` : "No courts"}</span>{pageCount > 1 ? <><button type="button" aria-label="Previous courts" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={17} /></button><button type="button" aria-label="Next courts" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}><ChevronRight size={17} /></button></> : null}</div></div><div className="monitor-zoom-court-grid">{visibleCourts.map((court) => <ZoomCourtCard key={court.id} court={court} now={now} queue={queue} />)}{!visibleCourts.length ? <div className="monitor-zoom-no-courts"><Trophy size={27} /><strong>No {format === "all" ? "" : format} courts in this session</strong><span>Choose a different format to see the live court board.</span></div> : null}</div></section>
      <aside className="monitor-zoom-side"><div className="monitor-side-tabs" role="tablist" aria-label="Monitor details"><button className={tab === "status" ? "active" : ""} type="button" role="tab" aria-selected={tab === "status"} onClick={() => setTab("status")}>Status</button><button className={tab === "matchups" ? "active" : ""} type="button" role="tab" aria-selected={tab === "matchups"} onClick={() => setTab("matchups")}>Head-to-head</button><button className={tab === "controls" ? "active" : ""} type="button" role="tab" aria-selected={tab === "controls"} aria-label="Monitor settings" onClick={() => setTab("controls")}><Settings2 size={15} /></button></div>
        <div className="monitor-side-content">{tab === "status" ? <><div className="monitor-side-summary"><div><strong>{liveCourts.length}</strong><span>IN PLAY</span></div><div><strong>{courts.length - liveCourts.length}</strong><span>OPEN</span></div><div><strong>{queue.length}</strong><span>WAITING</span></div></div><div className="monitor-status-list">{courts.map((court) => { const match = activeMatch(court); return <div key={court.id}><span className={match ? "live" : "open"}>{court.court_number || "–"}</span><div><strong>{court.venue_court?.name || `Court ${court.court_number}`}</strong><small>{match ? `${match.home_score || 0}–${match.away_score || 0} · ${elapsedTime(match.started_at, now)}` : "Open for next rotation"}</small></div><b>{match ? "LIVE" : "OPEN"}</b></div>; })}</div></> : tab === "matchups" ? <div className="monitor-matchups">{liveCourts.map((court) => { const match = activeMatch(court)!; const lineup = [...(match.open_play_match_players || [])].sort((a, b) => a.side - b.side || a.position - b.position); return <article key={court.id}><p>COURT {court.court_number || "–"}</p><div><span>{lineup.filter((player) => player.side === 0).map(playerName).join(" + ") || "Home team"}</span><strong>{match.home_score || 0}</strong></div><i>VS</i><div><span>{lineup.filter((player) => player.side === 1).map(playerName).join(" + ") || "Away team"}</span><strong>{match.away_score || 0}</strong></div></article>; })}{!liveCourts.length ? <div className="monitor-side-empty"><Trophy size={24} /><strong>No head-to-head matches yet</strong><span>Matchups appear as courts go live.</span></div> : null}</div> : <div className="monitor-controls"><p className="eyebrow">SESSION CONTROL</p><h3>{session.name}</h3><div><span>Session code</span><strong>{session.session_code || "—"}</strong></div><div><span>Checked in</span><strong>{data.registrations.filter((player) => Boolean(player.checked_in_at) && !player.departed_at).length}</strong></div><div><span>Match format</span><strong>{titleCase(session.match_format)}</strong></div><Link className="button button-accent" href={`/open-play/${session.id}/players`}>Manage check-in</Link><button className="button button-danger" type="button" onClick={onEnd}>End live session</button></div>}</div>
      </aside>
      <section className="monitor-live-feed" aria-label="Live updates"><div className="monitor-feed-title"><span><Radio size={16} /></span><div><p>LIVE UPDATES</p><h3>Court activity</h3></div></div><div className="monitor-feed-items">{updates.map((update) => <div key={update.id}><i className={update.tone} /><span><strong>{update.title}</strong><small>{update.detail}</small></span><time>{update.time}</time></div>)}</div></section>
    </div>
  </div>;
}

export function MonitorSection({ data, venueId, onVenueChange, refresh }: { data: OrganizerData; venueId: string | null; onVenueChange: (venueId: string | null) => void; refresh: () => Promise<void> }) {
  const [ending, setEnding] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const session = data.sessions.find((item) => isLiveOpenPlaySession(item));
  const registrations = registrationsForSession(data.registrations, session?.id);
  const queue = useMemo(() => sortQueue(registrations.filter((player) => player.status === "waiting" && player.registration_status === "approved" && Boolean(player.checked_in_at) && !player.departed_at)), [registrations]);
  const playing = registrations.filter((player) => player.status === "playing").length;
  const checkedIn = registrations.filter((player) => Boolean(player.checked_in_at) && !player.departed_at).length;
  useEffect(() => {
    if (!zoomed) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setZoomed(false); };
    const onFullscreenChange = () => { if (!document.fullscreenElement) setZoomed(false); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); document.removeEventListener("fullscreenchange", onFullscreenChange); };
  }, [zoomed]);
  if (!session) return <Empty title="No live session" detail="Open a scheduled session during its live time to activate lineup assignment, scoring, and the fair-play queue." />;

  const openZoom = () => {
    setZoomed(true);
    if (document.fullscreenEnabled && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
  };
  const closeZoom = () => {
    setZoomed(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };

  return <>
    <div className="live-banner monitor-banner"><span className="live-dot" /><div><strong>{session.name}</strong><span>Code {session.session_code || "—"} · {checkedIn} checked in · {playing} playing</span></div><button className="mini-button monitor-expand-button" type="button" onClick={openZoom}><Maximize2 size={14} /> Full-screen monitor</button><Link className="mini-button inline-action" href={`/open-play/${session.id}/players`}>Manage check-in</Link><button className="mini-button danger" type="button" onClick={() => setEnding(true)}>End session</button></div>
    <section className="card monitor-next-step"><span className="monitor-next-icon"><RotateCcw size={20} /></span><div><p className="eyebrow">WHAT HAPPENS NEXT</p><h2>{queue.length ? "Assign the next fair lineup." : "Check players in to build the queue."}</h2><p>{queue.length ? "Choose an open court below. Peakle moves the longest-waiting eligible players onto court and updates their app automatically." : "Approved players enter the live queue as soon as they check in. Return here to start their match."}</p></div><div className="monitor-next-metrics"><span><strong>{queue.length}</strong><small>WAITING</small></span><span><strong>{data.liveCourts.filter((court) => !activeMatch(court)).length}</strong><small>OPEN COURTS</small></span></div></section>
    <SectionTitle eyebrow="COURT OPERATIONS" title="Assign, score, and rotate" />
    <div className="court-grid">{data.liveCourts.map((court) => { const match = activeMatch(court); return match ? <LiveCourtCard key={court.id} court={court} match={match} /> : <OpenCourtCard key={court.id} court={court} queue={queue} sessionId={session.id} refresh={refresh} />; })}</div>
    {!data.liveCourts.length ? <Empty title="No session courts found" detail="This live session has no court setup. Return to the session details and verify its courts." /> : null}
    <SectionTitle eyebrow="FAIR-PLAY QUEUE" title={`${queue.length} player${queue.length === 1 ? "" : "s"} waiting`} action="Manage check-in" href={`/open-play/${session.id}/players`} />
    {queue.length ? <div className="table-card"><table className="data-table mobile-card-table queue-table"><thead><tr><th>POSITION</th><th>PLAYER</th><th>RATING</th><th>GAMES</th><th>STATUS</th></tr></thead><tbody>{queue.map((player, index) => <tr key={player.id}><td data-label="Position" className="table-primary">#{index + 1}</td><td data-label="Player" className="mobile-primary-cell"><Person registration={player} /></td><td data-label="Rating">{player.profiles?.skill_rating?.toFixed(1) || "—"}</td><td data-label="Games">{player.games_played || 0}</td><td data-label="Status"><Status value="waiting" /></td></tr>)}</tbody></table></div> : <Empty title="The live queue is empty" detail="Check in approved players from the roster. Their queue position will appear here immediately." action="Open roster" onAction={() => { window.location.href = `/open-play/${session.id}/players`; }} />}
    {zoomed ? <ZoomMonitor data={data} session={session} queue={queue} venueId={venueId} onVenueChange={onVenueChange} onClose={closeZoom} onEnd={() => { closeZoom(); setEnding(true); }} /> : null}
    {ending ? <SessionLifecycleDialog session={session} action="end" onClose={() => setEnding(false)} onComplete={async () => { setEnding(false); await refresh(); }} /> : null}
  </>;
}
