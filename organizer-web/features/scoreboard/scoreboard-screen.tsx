"use client";

import { Maximize2, Minimize2, Radio, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ScoreboardMatch, ScoreboardSnapshot } from "@/lib/scoreboard-types";
import { DISPLAY_POLL_MS, fetchScoreboard } from "@/lib/scoreboard";
import "./scoreboard.css";

function useScoreboard(token: string | null) {
  const [snapshot, setSnapshot] = useState<ScoreboardSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "connected" | "reconnecting" | "unavailable">("loading");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  useEffect(() => {
    if (!token) return;
    let active = true;
    let running = false;
    let revoked = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (!active || running || revoked) return;
      clearTimeout(timer);
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        if (!navigator.onLine) throw new Error("Offline");
        const result = await fetchScoreboard(token, controller.signal);
        if (!active) return;
        if (!result.available) {
          revoked = true; setSnapshot(null); setLastUpdated(null); setState("unavailable");
        } else { setSnapshot(result); setLastUpdated(Date.now()); setState("connected"); }
      } catch {
        if (active) setState("reconnecting");
      } finally {
        clearTimeout(timeout); running = false;
        if (active && !revoked) timer = setTimeout(() => void refresh(), DISPLAY_POLL_MS);
      }
    };
    const offline = () => { controller?.abort(); if (!revoked) setState("reconnecting"); };
    const resume = () => { if (!document.hidden) void refresh(); };
    void refresh();
    window.addEventListener("offline", offline);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { active = false; clearTimeout(timer); controller?.abort(); window.removeEventListener("offline", offline); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [token]);
  return { snapshot, state, lastUpdated };
}

function CourtScore({ court, ended }: { court: ScoreboardSnapshot["courts"][number]; ended: boolean }) {
  const match = court.match;
  const live = match?.status === "live";
  return <article className={`scoreboard-court ${live ? "is-live" : "is-waiting"}`} aria-label={`${court.name} scoreboard`}>
    <div className="scoreboard-court-head"><h2>{court.name}</h2><span>{ended ? "Event ended" : match?.paused ? "Paused" : live ? `Game ${match.game || 1}` : match ? "Up next" : "Court open"}</span></div>
    {match ? <><div className="scoreboard-sides">{([0, 1] as const).map((side) => <div key={side} className={`scoreboard-side side-${side}`}>
      <div className="scoreboard-player-name">{side === 0 ? match.home : match.away}</div>
      <strong className="scoreboard-score" aria-label={`${side === 0 ? "Home" : "Away"} score`}>{live ? safeScore(side === 0 ? match.home_score : match.away_score) : "–"}</strong>
      <span className={`scoreboard-serve ${live && match.server_side === side ? "is-serving" : ""}`}>{live && match.server_side === side ? <>● Serving{match.service_number ? ` · ${match.service_number}` : ""}</> : "\u00a0"}</span>
    </div>)}</div>{match.games?.length > 1 ? <div className="scoreboard-game-history">{match.games.map((game) => <span key={game.game_number}>G{game.game_number} <b>{safeScore(game.home_score)}–{safeScore(game.away_score)}</b></span>)}</div> : null}
      {!live ? <p className="scoreboard-waiting-note">Waiting for match to start</p> : null}</> : <div className="scoreboard-idle"><Radio size={38} /><h3>{ended ? "Thanks for playing" : "Waiting for next match"}</h3><p>{ended ? "The organizer can assign this display to the next event." : "The next court assignment will appear here automatically."}</p></div>}
  </article>;
}

function safeScore(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : "–"; }

function MatchResult({ match, side }: { match: ScoreboardMatch | null; side: number }) {
  if (!match || !["live", "completed"].includes(match.status)) return <>–</>;
  return <>{safeScore(side === 0 ? match.home_score : match.away_score)}</>;
}

function ScoreboardContent({ snapshot }: { snapshot: ScoreboardSnapshot }) {
  const [page, setPage] = useState(0);
  const mode = snapshot.display.mode;
  const rows = mode === "standings" ? snapshot.standings : mode === "bracket" ? snapshot.bracket : snapshot.courts;
  const perPage = mode === "standings" ? 8 : mode === "bracket" ? 6 : mode === "court" ? 1 : 4;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = page % pages;
  useEffect(() => {
    if (pages <= 1) return;
    const timer = setInterval(() => setPage((current) => (current + 1) % pages), 10000);
    return () => clearInterval(timer);
  }, [pages]);
  const start = safePage * perPage;
  const ended = ["completed", "cancelled"].includes(snapshot.event.status);
  return <>
    {mode === "court" || mode === "all_courts" ? <div className={`scoreboard-courts ${mode === "court" ? "single-court" : "multiple-courts"}`}>{snapshot.courts.slice(start, start + perPage).map((court) => <CourtScore key={court.id} court={court} ended={ended} />)}{!snapshot.courts.length ? <div className="scoreboard-idle"><h2>Court unavailable</h2><p>Ask the organizer to update this display’s court assignment.</p></div> : null}</div>
      : mode === "standings" ? <section className="scoreboard-standings" aria-label="Division standings"><table><thead><tr><th>Rank</th><th>Player / team</th><th>Played</th><th>Won</th><th>Lost</th><th>Points</th></tr></thead><tbody>{snapshot.standings.slice(start, start + perPage).map((entry, index) => <tr key={entry.id}><td>{start + index + 1}</td><th scope="row">{entry.name}</th><td>{entry.played}</td><td>{entry.won}</td><td>{entry.lost}</td><td>{entry.points}</td></tr>)}</tbody></table>{!snapshot.standings.length ? <div className="scoreboard-idle"><h2>No standings yet</h2></div> : null}</section>
        : <section className="scoreboard-bracket" aria-label="Tournament bracket">{snapshot.bracket.slice(start, start + perPage).map((entry) => <article key={entry.id} className="scoreboard-bracket-match"><header><span>Round {entry.round} · Match {entry.position}</span><b>{entry.status === "live" ? "LIVE" : entry.status === "completed" ? "FINAL" : entry.status === "bye" ? "BYE" : "UPCOMING"}</b></header>{[entry.home, entry.away].map((name, side) => <div key={side} className={entry.winner_side === side ? "winner" : ""}><span>{name}</span><strong><MatchResult match={entry.match} side={side} /></strong></div>)}</article>)}{!snapshot.bracket.length ? <div className="scoreboard-idle"><h2>No bracket yet</h2><p>Pairings will appear when the organizer seeds this division.</p></div> : null}</section>}
    {pages > 1 ? <div className="scoreboard-pagination">{mode === "standings" ? "Standings" : mode === "bracket" ? "Bracket" : "Courts"} · {safePage + 1} / {pages} · Changes every 10 seconds</div> : null}
  </>;
}

function ConnectedScoreboard({ token }: { token: string | null }) {
  const { snapshot, state, lastUpdated } = useScoreboard(token);
  const host = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (host.current?.requestFullscreen) await host.current.requestFullscreen();
      else setFullscreenError("Use your browser’s full-screen option for this display.");
    } catch { setFullscreenError("Use your browser’s full-screen option for this display."); }
  };
  return <div ref={host} className="scoreboard-screen">
    <header className="scoreboard-header"><div className="scoreboard-brand"><span>PEAKLE</span><small>{snapshot?.event.kind || "Court displays"}</small></div><div className="scoreboard-event"><h1>{snapshot?.event.name || "Live scoreboard"}</h1>{snapshot?.event.division ? <p>{snapshot.event.division}</p> : null}</div><button type="button" className="scoreboard-fullscreen" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit full screen" : "Enter full screen"}>{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}<span>{fullscreen ? "Exit" : "Full screen"}</span></button></header>
    {fullscreenError ? <p className="scoreboard-notice" role="status">{fullscreenError}</p> : null}
    <main className="scoreboard-main">{snapshot ? <ScoreboardContent key={`${snapshot.display.id}:${snapshot.display.revision}`} snapshot={snapshot} /> : <div className="scoreboard-idle">{state === "reconnecting" ? <WifiOff size={42} /> : <Radio size={42} />}<h2>{!token ? "Open a display link" : state === "unavailable" ? "Display disconnected" : state === "reconnecting" ? "Connecting to your scoreboard" : "Loading scoreboard…"}</h2><p>{!token ? "On the organizer’s computer, open Live Monitor → Full-screen monitor → Settings → Manage displays. Create a display and open its link on this screen." : state === "unavailable" ? "Ask the organizer for a new display link." : state === "reconnecting" ? "Check this computer’s internet connection. We’ll reconnect automatically." : "Your court assignment will appear in a moment."}</p></div>}</main>
    <footer className={`scoreboard-footer ${state === "reconnecting" ? "is-reconnecting" : ""}`}><span>{snapshot?.display.name || "Peakle court display"}</span><span role="status">{state === "reconnecting" ? <><WifiOff size={15} />Reconnecting · {lastUpdated ? `last updated ${new Date(lastUpdated).toLocaleTimeString()}` : "waiting for connection"}</> : snapshot ? <><i />Connected · updates automatically</> : state === "unavailable" ? "Link no longer available" : "Read-only display"}</span></footer>
  </div>;
}

export function ScoreboardScreen() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const read = () => { const value = window.location.hash.slice(1); setToken(/^[a-f0-9]{64}$/.test(value) ? value : null); };
    const timer = setTimeout(read, 0);
    window.addEventListener("hashchange", read);
    return () => { clearTimeout(timer); window.removeEventListener("hashchange", read); };
  }, []);
  return <ConnectedScoreboard key={token || "unpaired"} token={token} />;
}
