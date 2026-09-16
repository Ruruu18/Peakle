"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Eye, History, Maximize2, Minimize2, Play, Radio, RotateCcw, Settings2, Trophy, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { Competition, OpenPlayMatch, OpenPlaySession, OrganizerData, Registration } from "@/lib/types";
import { isLiveOpenPlaySession, registrationsForSession } from "@/lib/open-play";
import { activeMatch, Empty, isCourtScoring, Person, ProfileAvatar, SectionTitle, SelectControl, Status, titleCase } from "../components/portal-ui";
import { MatchHistoryDialog } from "../dialogs/match-history-dialog";
import { SessionLifecycleDialog } from "../dialogs/session-lifecycle-dialog";
import { CompetitionMonitor } from "./competition-monitor";
import { DisplaySettingsButton } from "../dialogs/display-settings-dialog";
import { MonitorCourt } from "../components/monitor-court";

const playerName = (lineup: NonNullable<OpenPlayMatch["open_play_match_players"]>[number]) =>
  lineup.open_play_players?.profiles?.display_name || lineup.open_play_players?.guest_name || "Guest player";

const sortQueue = (players: Registration[]) => [...players].sort((a, b) =>
  Number(a.queue_position ?? Number.MAX_SAFE_INTEGER) - Number(b.queue_position ?? Number.MAX_SAFE_INTEGER)
  || new Date(a.waiting_since || a.checked_in_at || a.joined_at || 0).getTime() - new Date(b.waiting_since || b.checked_in_at || b.joined_at || 0).getTime()
);

function NextLineupPlayers({ players }: { players: Registration[] }) {
  return <ol className="lineup-chips" aria-label="Next players in queue order">
    {players.map((player, index) => {
      const name = player.profiles?.display_name || player.guest_name || "Guest player";
      return <li className="lineup-chip" key={player.id}>
        <span className="lineup-player-photo">
          <ProfileAvatar name={name} photo={player.profiles?.avatar_url} />
          <b className="lineup-player-position" aria-hidden="true">{index + 1}</b>
        </span>
        <span className="lineup-player-name" title={name}>{name}</span>
      </li>;
    })}
  </ol>;
}

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
      toast.success(`${court.venue_court?.name || `Court ${court.court_number}`} lineup assigned. Players were notified.`);
      await refresh();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "The lineup could not be assigned.");
    } finally { setBusy(false); }
  };

  return <article className="card court-card court-operation-card">
    <div className="court-card-head"><span className="court-number">{court.court_number || "–"}</span><div><h3>{court.venue_court?.name || `Court ${court.court_number}`}</h3><p>{titleCase(court.match_format || "doubles")}</p></div><Status value="open" /></div>
    <MonitorCourt format={court.match_format} />
    <div className="next-lineup">
      <div className="next-lineup-head"><span>NEXT FAIR LINEUP</span><strong>{recommended.length}/{expectedPlayers}</strong></div>
      {recommended.length ? <NextLineupPlayers players={recommended} /> : <p>No checked-in players are waiting yet.</p>}
    </div>
    {missing > 0 ? <div className="court-action-note"><Users size={15} /><span>Check in {missing} more player{missing === 1 ? "" : "s"} to start this {court.match_format === "singles" ? "singles" : "doubles"} match.</span></div> : !scorer ? <div className="court-action-note"><Users size={15} /><span>Add at least one signed-in Peakle player so the match has a player scorer.</span></div> : <div className="court-action-note ready"><Check size={15} /><span>{scorer.profiles?.display_name || scorer.guest_name || "The first signed-in player"} will score from the player app.</span></div>}
    <button className="button button-accent court-primary-action" type="button" disabled={busy || missing > 0 || !scorer} onClick={() => void assign()}><Play size={15} />{busy ? "Starting match…" : "Assign & send to court"}</button>
  </article>;
}

function LiveCourtCard({ court, match, onViewHistory }: {
  court: OrganizerData["liveCourts"][number];
  match: OpenPlayMatch;
  onViewHistory: (match: OpenPlayMatch, homeName: string, awayName: string) => void;
}) {
  const scores: [number, number] = [Number(match.home_score || 0), Number(match.away_score || 0)];
  const lineup = [...(match.open_play_match_players || [])].sort((a, b) => a.side - b.side || a.position - b.position);
  const sides = [lineup.filter((player) => player.side === 0), lineup.filter((player) => player.side === 1)];
  const scorer = lineup.find((player) => player.player_id === match.scorer_player_id);
  const homeName = sides[0].map(playerName).join(" + ") || "Home";
  const awayName = sides[1].map(playerName).join(" + ") || "Away";
  const scoring = scores[0] > 0 || scores[1] > 0;

  return <article className={`card court-card court-operation-card ${scoring ? "live-court-card" : "starting-court-card"}`}>
    <div className="court-card-head"><span className="court-number">{court.court_number || "–"}</span><div><h3>{court.venue_court?.name || `Court ${court.court_number}`}</h3><p>{titleCase(court.match_format || "doubles")} · {scoring ? "live now" : "starting"}</p></div><Status value={scoring ? "playing" : "starting"} /></div>
    <MonitorCourt match={match} format={court.match_format} />
    <div className="player-scoring-note"><Eye size={15} /><span><strong>{scorer ? playerName(scorer) : "Assigned player"}</strong> is scoring from the player app. This monitor updates automatically.</span></div>
    <button className="mini-button inline-action match-history-trigger" type="button" onClick={() => onViewHistory(match, homeName, awayName)}><History size={14} /> View match history</button>
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
  const needed = court.match_format === "singles" ? 2 : 4;
  const nextPlayers = queue.slice(0, needed);
  const missing = needed - nextPlayers.length;
  const scoring = Boolean(match) && (Number(match?.home_score || 0) > 0 || Number(match?.away_score || 0) > 0);

  return <article className={`zoom-court-card ${scoring ? "is-live" : match ? "is-starting" : "is-open"}`}>
    <div className="zoom-court-head"><div><span>COURT {court.court_number || "–"}</span><h3>{court.venue_court?.name || `Court ${court.court_number}`}</h3></div><span className={`zoom-court-state ${scoring ? "live" : ""}`}>{scoring ? <><i className="live-dot" />LIVE</> : match ? "STARTING" : "OPEN"}</span></div>
    <MonitorCourt match={match} format={court.match_format} elapsed={match ? elapsedTime(match.started_at, now) : undefined} />
    {!match && <div className="zoom-next-lineup">
      <small><RotateCcw size={11} />NEXT FAIR LINEUP</small>
      {nextPlayers.length > 0 && <NextLineupPlayers players={nextPlayers} />}
      {missing > 0 && <strong>Waiting for {missing} more player{missing === 1 ? "" : "s"}</strong>}
    </div>}
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
  const liveCourts = courts.filter((court) => isCourtScoring(court));

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const updates = courts.map((court) => {
    const match = activeMatch(court);
    const label = court.venue_court?.name || `Court ${court.court_number}`;
    if (!match) return { id: court.id, tone: "open", title: `${label} is open`, detail: "Ready to receive the next fair lineup.", time: "NOW" };
    const lineup = [...(match.open_play_match_players || [])].sort((a, b) => a.side - b.side || a.position - b.position);
    const home = lineup.filter((player) => player.side === 0).map(playerName).join(" + ") || "Home";
    const away = lineup.filter((player) => player.side === 1).map(playerName).join(" + ") || "Away";
    const scoring = Number(match.home_score || 0) > 0 || Number(match.away_score || 0) > 0;
    if (!scoring) return { id: court.id, tone: "open", title: `${label} is starting`, detail: `${home} vs ${away} · about to begin`, time: elapsedTime(match.started_at, now) };
    return { id: court.id, tone: "live", title: `${label} is live`, detail: `${home} vs ${away} · ${match.home_score || 0}–${match.away_score || 0}`, time: elapsedTime(match.started_at, now) };
  });

  return <div className="monitor-zoom" role="dialog" aria-modal="true" aria-label="Expanded live court monitor">
    <header className="monitor-zoom-header"><div className="monitor-zoom-brand"><span><Radio size={18} /></span><div><p>PEAKLE · LIVE MONITOR</p><h2>{session.name}</h2></div></div><div className="monitor-zoom-venue"><SelectControl value={venueId || data.venues[0]?.id || ""} options={data.venues.map((venue) => ({ value: venue.id, label: venue.name, detail: venue.area || "Organizer venue" }))} onChange={(value) => { setPage(0); onVenueChange(value || null); }} ariaLabel="Monitor venue" disabled={!data.venues.length} /></div><div className="monitor-format-switch" aria-label="Court format filter">{(["all", "singles", "doubles"] as FormatFilter[]).map((value) => <button key={value} className={format === value ? "active" : ""} type="button" aria-pressed={format === value} onClick={() => { setPage(0); setFormat(value); }}>{value === "all" ? "All courts" : titleCase(value)}</button>)}</div><button className="monitor-zoom-close" type="button" aria-label="Exit expanded monitor" onClick={onClose}><Minimize2 size={19} /><span>Exit</span></button></header>
    <div className="monitor-zoom-body">
      <section className="monitor-zoom-courts" aria-label="Court scoreboards"><div className="monitor-zoom-section-head"><div><p>COURT SCOREBOARDS</p><h2>{format === "all" ? "All courts" : `${titleCase(format)} courts`}</h2></div><div className="monitor-court-pager"><span>{courts.length ? `${safePage * 4 + 1}–${Math.min(safePage * 4 + 4, courts.length)} of ${courts.length}` : "No courts"}</span>{pageCount > 1 ? <><button type="button" aria-label="Previous courts" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={17} /></button><button type="button" aria-label="Next courts" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}><ChevronRight size={17} /></button></> : null}</div></div><div className="monitor-zoom-court-grid">{visibleCourts.map((court) => <ZoomCourtCard key={court.id} court={court} now={now} queue={queue} />)}{!visibleCourts.length ? <div className="monitor-zoom-no-courts"><Trophy size={27} /><strong>No {format === "all" ? "" : format} courts in this session</strong><span>Choose a different format to see the court board.</span></div> : null}</div></section>
      <aside className="monitor-zoom-side"><div className="monitor-side-tabs" role="tablist" aria-label="Monitor details"><button className={tab === "status" ? "active" : ""} type="button" role="tab" aria-selected={tab === "status"} onClick={() => setTab("status")}>Status</button><button className={tab === "matchups" ? "active" : ""} type="button" role="tab" aria-selected={tab === "matchups"} onClick={() => setTab("matchups")}>Head-to-head</button><button className={tab === "controls" ? "active" : ""} type="button" role="tab" aria-selected={tab === "controls"} aria-label="Monitor settings" onClick={() => setTab("controls")}><Settings2 size={15} /></button></div>
        <div className="monitor-side-content">{tab === "status" ? <><div className="monitor-side-summary"><div><strong>{liveCourts.length}</strong><span>IN PLAY</span></div><div><strong>{courts.length - liveCourts.length}</strong><span>OPEN</span></div><div><strong>{queue.length}</strong><span>WAITING</span></div></div><div className="monitor-status-list">{courts.map((court) => { const match = activeMatch(court); const scoring = isCourtScoring(court); return <div key={court.id}><span className={scoring ? "live" : "open"}>{court.court_number || "–"}</span><div><strong>{court.venue_court?.name || `Court ${court.court_number}`}</strong><small>{scoring ? `${match?.home_score || 0}–${match?.away_score || 0} · ${elapsedTime(match?.started_at, now)}` : match ? "Starting · about to begin" : "Open for next rotation"}</small></div><b>{scoring ? "LIVE" : match ? "STARTING" : "OPEN"}</b></div>; })}</div></> : tab === "matchups" ? <div className="monitor-matchups">{liveCourts.map((court) => { const match = activeMatch(court)!; const lineup = [...(match.open_play_match_players || [])].sort((a, b) => a.side - b.side || a.position - b.position); return <article key={court.id}><p>COURT {court.court_number || "–"}</p><div><span>{lineup.filter((player) => player.side === 0).map(playerName).join(" + ") || "Home team"}</span><strong>{match.home_score || 0}</strong></div><i>VS</i><div><span>{lineup.filter((player) => player.side === 1).map(playerName).join(" + ") || "Away team"}</span><strong>{match.away_score || 0}</strong></div></article>; })}{!liveCourts.length ? <div className="monitor-side-empty"><Trophy size={24} /><strong>No head-to-head matches yet</strong><span>Matchups appear as courts go live.</span></div> : null}</div> : <div className="monitor-controls"><p className="eyebrow">SESSION CONTROL</p><h3>{session.name}</h3><div><span>Session code</span><strong>{session.session_code || "—"}</strong></div><div><span>Checked in</span><strong>{data.registrations.filter((player) => Boolean(player.checked_in_at) && !player.departed_at).length}</strong></div><div><span>Match format</span><strong>{titleCase(session.match_format)}</strong></div><DisplaySettingsButton panel data={data} venueId={session.venue_id || venueId} source={`session:${session.id}`} /><Link className="button button-accent" href={`/open-play/${session.id}/players`}>Manage check-in</Link><button className="button button-danger" type="button" onClick={onEnd}>End live session</button></div>}</div>
      </aside>
      <section className="monitor-live-feed" aria-label="Live updates"><div className="monitor-feed-title"><span><Radio size={16} /></span><div><p>LIVE UPDATES</p><h3>Court activity</h3></div></div><div className="monitor-feed-items">{updates.map((update) => <div key={update.id}><i className={update.tone} /><span><strong>{update.title}</strong><small>{update.detail}</small></span><time>{update.time}</time></div>)}</div></section>
    </div>
  </div>;
}

function OpenPlayMonitorSection({ data, sessionId, venueId, onVenueChange, refresh }: { data: OrganizerData; sessionId: string; venueId: string | null; onVenueChange: (venueId: string | null) => void; refresh: () => Promise<void> }) {
  const [ending, setEnding] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [historyMatch, setHistoryMatch] = useState<{ id: string; homeName: string; awayName: string } | null>(null);
  const session = data.sessions.find((item) => item.id === sessionId && isLiveOpenPlaySession(item));
  const registrations = registrationsForSession(data.registrations, session?.id);
  const monitorData = useMemo(() => ({
    ...data,
    registrations,
    liveCourts: data.liveCourts.filter((court) => court.session_id === sessionId),
  }), [data, registrations, sessionId]);
  const queue = useMemo(() => sortQueue(registrations.filter((player) => player.status === "waiting" && player.registration_status === "approved" && Boolean(player.checked_in_at) && !player.departed_at)), [registrations]);
  const playing = monitorData.liveCourts.reduce((total, court) => {
    if (!isCourtScoring(court)) return total;
    return total + (activeMatch(court)?.open_play_match_players?.length || 0);
  }, 0);
  const checkedIn = registrations.filter((player) => Boolean(player.checked_in_at) && !player.departed_at).length;
  const anyCourtScoring = monitorData.liveCourts.some((court) => isCourtScoring(court));
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
    <div className="live-banner monitor-banner"><span className={`live-dot ${anyCourtScoring ? "" : "idle"}`} /><div><strong>{session.name}</strong><span>Code {session.session_code || "—"} · {checkedIn} checked in · {playing} playing</span></div><button className="mini-button monitor-expand-button" type="button" onClick={openZoom}><Maximize2 size={14} /> Full-screen monitor</button><Link className="mini-button inline-action" href={`/open-play/${session.id}/players`}>Manage check-in</Link><button className="mini-button danger" type="button" onClick={() => setEnding(true)}>End session</button></div>
    <section className="card monitor-next-step"><span className="monitor-next-icon"><RotateCcw size={20} /></span><div><p className="eyebrow">WHAT HAPPENS NEXT</p><h2>{queue.length ? "Assign the next fair lineup." : "Check players in to build the queue."}</h2><p>{queue.length ? "Choose an open court below. Peakle moves the longest-waiting eligible players onto court and updates their app automatically." : "Approved players enter the live queue as soon as they check in. Return here to start their match."}</p></div><div className="monitor-next-metrics"><span><strong>{queue.length}</strong><small>WAITING</small></span><span><strong>{monitorData.liveCourts.filter((court) => !activeMatch(court)).length}</strong><small>OPEN COURTS</small></span></div></section>
    <SectionTitle eyebrow="COURT OPERATIONS" title="Assign, score, and rotate" />
    <div className="court-grid">{monitorData.liveCourts.map((court) => { const match = activeMatch(court); return match ? <LiveCourtCard key={court.id} court={court} match={match} onViewHistory={(viewedMatch, homeName, awayName) => setHistoryMatch({ id: viewedMatch.id, homeName, awayName })} /> : <OpenCourtCard key={court.id} court={court} queue={queue} sessionId={session.id} refresh={refresh} />; })}</div>
    {!monitorData.liveCourts.length ? <Empty title="No session courts found" detail="This live session has no court setup. Return to the session details and verify its courts." /> : null}
    <SectionTitle eyebrow="FAIR-PLAY QUEUE" title={`${queue.length} player${queue.length === 1 ? "" : "s"} waiting`} action="Manage check-in" href={`/open-play/${session.id}/players`} />
    {queue.length ? <div className="table-card"><table className="data-table mobile-card-table queue-table"><thead><tr><th>POSITION</th><th>PLAYER</th><th>RATING</th><th>GAMES</th><th>STATUS</th></tr></thead><tbody>{queue.map((player, index) => <tr key={player.id}><td data-label="Position" className="table-primary">#{index + 1}</td><td data-label="Player" className="mobile-primary-cell"><Person registration={player} /></td><td data-label="Rating">{player.profiles?.skill_rating?.toFixed(1) || "—"}</td><td data-label="Games">{player.games_played || 0}</td><td data-label="Status"><Status value="waiting" /></td></tr>)}</tbody></table></div> : <Empty title="The live queue is empty" detail="Check in approved players from the roster. Their queue position will appear here immediately." action="Open roster" onAction={() => { window.location.href = `/open-play/${session.id}/players`; }} />}
    {zoomed ? <ZoomMonitor data={monitorData} session={session} queue={queue} venueId={venueId} onVenueChange={onVenueChange} onClose={closeZoom} onEnd={() => { closeZoom(); setEnding(true); }} /> : null}
    {ending ? <SessionLifecycleDialog session={session} action="end" onClose={() => setEnding(false)} onComplete={async () => { setEnding(false); await refresh(); }} /> : null}
    {historyMatch ? <MatchHistoryDialog matchId={historyMatch.id} homeName={historyMatch.homeName} awayName={historyMatch.awayName} onClose={() => setHistoryMatch(null)} /> : null}
  </>;
}

function CompetitionMonitorLaunch({ competitions, competitionId, displaySettings }: { competitions: Competition[]; competitionId: string; displaySettings: React.ReactNode }) {
  const [presenting, setPresenting] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const competition = competitions.find((item) => item.id === competitionId);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  if (!competition) return <Empty title="Competition not found" detail="Choose another active competition from the Live Monitor." />;

  const divisions = competition.competition_divisions?.length || 0;
  const entries = competition.competition_divisions?.flatMap((division) => division.competition_entries || []).length || 0;
  const openPresentation = () => {
    const host = hostRef.current;
    if (!host || !document.fullscreenEnabled) {
      toast.error("Full-screen presentation is not available in this browser.");
      return;
    }
    setPresenting(true);
    void host.requestFullscreen().catch(() => {
      setPresenting(false);
      toast.error("The competition monitor could not enter full screen.");
    });
  };

  return <div ref={hostRef} className="competition-presentation-host">
    {presenting ? <CompetitionMonitor competitions={competitions} competitionId={competitionId} presentationFullscreen displaySettings={displaySettings} /> : <>
      <div className="live-banner monitor-banner"><span className="live-dot" /><div><strong>{competition.name}</strong><span>{titleCase(competition.kind || "competition")} · {divisions} divisions · {entries} entries</span></div><button className="mini-button monitor-expand-button" type="button" onClick={openPresentation}><Maximize2 size={14} /> Full-screen monitor</button><Link className="mini-button inline-action" href={`/competitions/${competition.id}`}>Manage competition</Link></div>
      <section className="card monitor-next-step"><span className="monitor-next-icon"><Trophy size={20} /></span><div><p className="eyebrow">COMPETITION PRESENTATION</p><h2>Ready for the venue display.</h2><p>The bracket, live score, next match, and update feed stay hidden here until you launch the full-screen monitor.</p></div><div className="monitor-next-metrics"><span><strong>{divisions}</strong><small>DIVISIONS</small></span><span><strong>{entries}</strong><small>ENTRIES</small></span></div></section>
    </>}
  </div>;
}

export function MonitorSection({ data, venueId, onVenueChange, refresh }: { data: OrganizerData; venueId: string | null; onVenueChange: (venueId: string | null) => void; refresh: () => Promise<void> }) {
  const searchParams = useSearchParams();
  const [selectedSource, setSelectedSource] = useState("");
  const monitorData = data;
  const liveSessions = monitorData.sessions.filter((item) => (!venueId || item.venue_id === venueId) && isLiveOpenPlaySession(item));
  const competitions = data.competitions.filter((item) => (!venueId || item.venue_id === venueId) && item.status === "active");
  const options = [
    ...liveSessions.map((session) => ({ value: `session:${session.id}`, label: session.name, detail: "Open play" })),
    ...competitions.map((competition) => ({ value: `competition:${competition.id}`, label: competition.name, detail: titleCase(competition.kind || "competition") })),
  ];
  const requestedCompetition = searchParams.get("competition");
  const requestedSession = searchParams.get("session");
  const requestedSource = requestedCompetition && competitions.some((item) => item.id === requestedCompetition)
    ? `competition:${requestedCompetition}`
    : requestedSession && liveSessions.some((item) => item.id === requestedSession)
      ? `session:${requestedSession}`
      : "";
  const source = options.some((option) => option.value === selectedSource)
    ? selectedSource
    : requestedSource || options[0]?.value || "";

  const displaySettings = <DisplaySettingsButton data={data} venueId={venueId} source={source} />;
  if (!source) return <>{displaySettings}<Empty title="Nothing is live" detail="Start an open-play session or activate a competition to show it in the Live Monitor." /></>;

  const picker = options.length > 1 ? <div className="competition-monitor-switchers monitor-activity-switcher">
    <SelectControl value={source} options={options} onChange={setSelectedSource} ariaLabel="Live activity" className="competition-switch" />
  </div> : null;

  if (source.startsWith("competition:")) {
    const competitionId = source.slice("competition:".length);
    return <>{displaySettings}{picker}<CompetitionMonitorLaunch competitions={competitions} competitionId={competitionId} displaySettings={displaySettings} /></>;
  }

  const sessionId = source.slice("session:".length);
  return <>{picker}<OpenPlayMonitorSection data={monitorData} sessionId={sessionId} venueId={venueId} onVenueChange={onVenueChange} refresh={refresh} /></>;
}
