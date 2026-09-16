"use client";

import { useRouter } from "next/navigation";
import { Check, Crown, Maximize2, Minimize2, Pencil, Radio, RotateCcw, Sparkles, Trophy, X, ZoomIn, ZoomOut } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { Competition, CompetitionBracketMatch, CompetitionDivision, CompetitionEntry } from "@/lib/types";
import { Empty, ProfileAvatar, SelectControl, Status, titleCase } from "../components/portal-ui";
import { PointAnnouncementOverlay } from "../components/monitor-court";

const CARD_W = 264;
const CARD_H = 76;
const ROW_GAP = 22;
const COL_GAP = 70;
const UNIT0 = CARD_H + ROW_GAP;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 1.5;

const entryName = (entry?: CompetitionEntry | null) => entry?.profiles?.display_name || (entry?.teams?.name ? `${entry.teams.name}${entry.teams.tag ? ` (${entry.teams.tag})` : ""}` : null);

const roundLabel = (round: number, totalRounds: number) => {
  if (round === totalRounds) return "Final";
  if (round === totalRounds - 1) return "Semifinal";
  if (round === totalRounds - 2) return "Quarterfinal";
  return `Round ${round}`;
};

const sortedGames = (match: CompetitionBracketMatch) => [...(match.matches?.match_games || [])].sort((a, b) => a.game_number - b.game_number);

const matchScore = (match: CompetitionBracketMatch): [number, number] | null => {
  const games = sortedGames(match);
  if (!games.length) return null;
  if (games.length === 1) return [games[0].home_score, games[0].away_score];
  const homeGames = games.filter((game) => game.winner_side === 0).length;
  const awayGames = games.filter((game) => game.winner_side === 1).length;
  return [homeGames, awayGames];
};

const matchTime = (match: CompetitionBracketMatch) => match.matches?.ended_at || match.matches?.started_at || match.scheduled_at || null;

function BracketEntrant({ entry, label }: { entry?: CompetitionEntry | null; label: string }) {
  return <span className="bracket-slot-name" title={label}>
    {entry?.seed ? <small className="bracket-seed">{entry.seed}</small> : <small className="bracket-seed bracket-seed-empty">–</small>}
    {entry ? <ProfileAvatar name={label} photo={entry.profiles?.avatar_url} className="bracket-avatar" /> : <span className="bracket-avatar bracket-avatar-empty" />}
    <em>{label}</em>
  </span>;
}

function useCompetitionBracket(competitionId: string) {
  const [remoteDivisions, setRemoteDivisions] = useState<
    CompetitionDivision[] | null
  >(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!competitionId) return;
    let cancelled = false;
    (async () => {
      const { data, error: queryError } = await requireSupabase()
        .from("competition_divisions")
        .select("id,competition_id,name,participant_division,format,skill_category,entry_type,capacity,status,position,competition_entries(id,competition_id,competition_division_id,user_id,team_id,seed,status,eligibility_status,profiles(display_name,avatar_url),teams(name,tag)),competition_bracket_matches(id,competition_id,competition_division_id,round_number,position,home_entry_id,away_entry_id,winner_entry_id,match_id,status,scheduled_at,matches(id,status,scheduled_at,started_at,ended_at,match_games(id,game_number,home_score,away_score,winner_side)))")
        .eq("competition_id", competitionId)
        .order("position");
      if (cancelled) return;
      if (queryError) setError(queryError.message || "The bracket could not be loaded.");
      else { setError(""); setRemoteDivisions((data || []) as unknown as CompetitionDivision[]); }
    })();
    return () => { cancelled = true; };
  }, [competitionId, reloadKey]);

  useEffect(() => {
    if (!competitionId) return;
    const client = requireSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queueReload = () => { clearTimeout(timer); timer = setTimeout(() => setReloadKey((key) => key + 1), 350); };
    const channel = client.channel(`competition-monitor-${competitionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "competition_bracket_matches", filter: `competition_id=eq.${competitionId}` }, queueReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "competition_entries", filter: `competition_id=eq.${competitionId}` }, queueReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `competition_id=eq.${competitionId}` }, queueReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_games" }, queueReload)
      .subscribe();
    return () => { clearTimeout(timer); void client.removeChannel(channel); };
  }, [competitionId]);

  return {
    divisions: remoteDivisions,
    error,
  };
}

function ScoreEntryActions({ match, home, away, onDone, onCancel }: { match: CompetitionBracketMatch; home: string; away: string; onDone: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const homeScore = Number(home);
    const awayScore = Number(away);
    if (!match.match_id) { toast.error("This match has not been scheduled yet."); return; }
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore < 0 || awayScore < 0 || homeScore === awayScore) {
      toast.error("Enter two valid scores with one winner.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc("record_competition_match_result", { p_match_id: match.match_id, p_home_score: homeScore, p_away_score: awayScore });
      if (error) throw error;
      toast.success("Result recorded.");
      onDone();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "The result could not be recorded.");
    } finally { setBusy(false); }
  };

  return <div className="bracket-score-actions" onClick={(event) => event.stopPropagation()}>
    <button type="button" className="bracket-score-save" aria-label="Save result" disabled={busy} onClick={() => void submit()}><Check size={11} /></button>
    <button type="button" className="bracket-score-cancel" aria-label="Cancel" disabled={busy} onClick={onCancel}><X size={11} /></button>
  </div>;
}

function BracketTree({ matches, entryById }: { matches: CompetitionBracketMatch[]; entryById: Map<string, CompetitionEntry> }) {
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [homeInput, setHomeInput] = useState("");
  const [awayInput, setAwayInput] = useState("");
  const rounds = useMemo(() => {
    const byRound = new Map<number, CompetitionBracketMatch[]>();
    matches.forEach((match) => { const list = byRound.get(match.round_number) || []; list.push(match); byRound.set(match.round_number, list); });
    return [...byRound.entries()].sort(([a], [b]) => a - b).map(([round, list]) => [round, [...list].sort((a, b) => a.position - b.position)] as const);
  }, [matches]);
  const totalRounds = rounds.length;
  const round1Count = rounds[0]?.[1].length || 1;
  const containerHeight = UNIT0 * round1Count;
  const finalMatch = rounds[totalRounds - 1]?.[1][0];
  const championEntry = finalMatch?.winner_entry_id ? entryById.get(finalMatch.winner_entry_id) : null;
  const finalScore = finalMatch ? matchScore(finalMatch) : null;
  const championScore = finalScore && finalMatch
    ? (finalMatch.winner_entry_id === finalMatch.home_entry_id ? finalScore[0] : finalMatch.winner_entry_id === finalMatch.away_entry_id ? finalScore[1] : null)
    : null;

  const unitFor = (roundIndex: number) => UNIT0 * 2 ** roundIndex;
  const topFor = (roundIndex: number, positionOneIndexed: number) => {
    const unit = unitFor(roundIndex);
    return (positionOneIndexed - 1) * unit + (unit - CARD_H) / 2;
  };

  if (!totalRounds) return <div className="bracket-empty"><Trophy size={26} /><strong>No bracket yet</strong><span>Seed the tournament bracket for this division to see it appear here.</span></div>;

  const championTop = topFor(totalRounds - 1, 1);

  return <div className="bracket-tree" style={{ height: containerHeight }}>
    {rounds.map(([round, list], roundIndex) => <div key={round} className="bracket-column" style={{ width: CARD_W, height: containerHeight }}>
      <div className="bracket-round-label" style={{ top: -40 }}><span>{roundLabel(round, totalRounds)}</span><small>{list.length} {list.length === 1 ? "match" : "matches"}</small></div>
      {list.map((match) => {
        const home = match.home_entry_id ? entryById.get(match.home_entry_id) : null;
        const away = match.away_entry_id ? entryById.get(match.away_entry_id) : null;
        const score = matchScore(match);
        const winnerId = match.winner_entry_id;
        const homeLabel = entryName(home) || (match.status === "bye" && !match.away_entry_id ? "" : "TBD");
        const awayLabel = entryName(away) || (match.status === "bye" ? "BYE" : "TBD");
        const canScore = (match.status === "ready" || match.status === "live") && Boolean(match.home_entry_id) && Boolean(match.away_entry_id) && Boolean(match.match_id);
        const isScoring = scoringId === match.id;
        const startScoring = () => {
          const current = matchScore(match);
          setHomeInput(current ? String(current[0]) : "");
          setAwayInput(current ? String(current[1]) : "");
          setScoringId(match.id);
        };
        const stopScoring = () => { setScoringId(null); setHomeInput(""); setAwayInput(""); };
        return <div key={match.id} className={`bracket-match status-${match.status}`} style={{ top: topFor(roundIndex, match.position), width: CARD_W, height: CARD_H }}>
          {match.status === "live" ? <span className="bracket-live-badge"><i /> LIVE</span> : null}
          {isScoring ? <ScoreEntryActions match={match} home={homeInput} away={awayInput} onDone={stopScoring} onCancel={stopScoring} />
            : canScore ? <button type="button" className="bracket-score-trigger" onClick={startScoring}><Pencil size={9} /> SCORE</button> : null}
          <div className={`bracket-slot ${winnerId && winnerId === match.home_entry_id ? "winner" : ""}`}>
            <BracketEntrant entry={home} label={homeLabel} />
            {isScoring
              ? <input type="number" inputMode="numeric" className="bracket-slot-score-input" value={homeInput} onChange={(event) => setHomeInput(event.target.value)} onClick={(event) => event.stopPropagation()} />
              : <b className={score && score[0] > score[1] ? "high-score" : ""}>{score ? score[0] : match.status === "bye" ? "" : "–"}</b>}
          </div>
          <div className={`bracket-slot ${winnerId && winnerId === match.away_entry_id ? "winner" : ""}`}>
            <BracketEntrant entry={away} label={awayLabel} />
            {isScoring
              ? <input type="number" inputMode="numeric" className="bracket-slot-score-input" value={awayInput} onChange={(event) => setAwayInput(event.target.value)} onClick={(event) => event.stopPropagation()} />
              : <b className={score && score[1] > score[0] ? "high-score" : ""}>{score ? score[1] : match.status === "bye" ? "" : "–"}</b>}
          </div>
        </div>;
      })}
    </div>)}
    <div className="bracket-column bracket-champion-column" style={{ width: CARD_W, height: containerHeight }}>
      <div className="bracket-round-label bracket-champion-label" style={{ top: -40 }}><span>Champion</span><small>Winner</small></div>
      <div className="bracket-match bracket-champion" style={{ top: championTop, width: CARD_W, height: CARD_H }}>
        <Crown className="bracket-champion-crown" size={18} />
        <div className="bracket-slot winner"><BracketEntrant entry={championEntry} label={entryName(championEntry) || "To be decided"} />{championEntry ? <b>{championScore ?? ""}</b> : null}</div>
      </div>
    </div>
    <svg className="bracket-connectors" width="100%" height={containerHeight} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {rounds.map(([, list], roundIndex) => {
        const columnLeft = roundIndex * (CARD_W + COL_GAP);
        const half = columnLeft + CARD_W + COL_GAP / 2;
        const isFinalRound = roundIndex === totalRounds - 1;
        return list.map((match) => {
          const yFeeder = topFor(roundIndex, match.position) + CARD_H / 2;
          if (isFinalRound) return <path key={match.id} d={`M${columnLeft + CARD_W},${yFeeder} H${columnLeft + CARD_W + COL_GAP}`} className={`bracket-connector-path ${match.winner_entry_id ? "active" : ""}`} />;
          const targetList = rounds[roundIndex + 1][1];
          const targetMatch = targetList.find((candidate) => candidate.position === Math.ceil(match.position / 2));
          if (!targetMatch) return null;
          const yTarget = topFor(roundIndex + 1, targetMatch.position) + CARD_H / 2;
          return <path key={match.id} d={`M${columnLeft + CARD_W},${yFeeder} H${half} V${yTarget} H${columnLeft + CARD_W + COL_GAP}`} className={`bracket-connector-path ${match.winner_entry_id ? "active" : ""}`} />;
        });
      })}
    </svg>
  </div>;
}

export function CompetitionMonitor({ competitions, competitionId, presentationFullscreen = false, displaySettings }: { competitions: Competition[]; competitionId: string; presentationFullscreen?: boolean; displaySettings?: React.ReactNode }) {
  const router = useRouter();
  const { divisions, error } = useCompetitionBracket(competitionId);
  const competition = competitions.find((item) => item.id === competitionId);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>("");
  const [zoom, setZoom] = useState(0.8);
  const [fullscreen, setFullscreen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const divisionId = divisions?.some((division) => division.id === selectedDivisionId) ? selectedDivisionId : divisions?.[0]?.id || "";
  const division = divisions?.find((item) => item.id === divisionId) || null;
  const entryById = useMemo(() => new Map((division?.competition_entries || []).map((entry) => [entry.id, entry])), [division]);
  const matches = useMemo(() => division?.competition_bracket_matches || [], [division]);

  const nextMatch = useMemo(() => {
    const live = matches.find((match) => match.status === "live");
    if (live) return live;
    return [...matches].filter((match) => match.status === "ready").sort((a, b) => a.round_number - b.round_number || a.position - b.position)[0] || null;
  }, [matches]);
  const totalRounds = matches.reduce((max, match) => Math.max(max, match.round_number), 0);
  const liveMatches = matches.filter((match) => match.status === "live").length;
  const completedMatches = matches.filter((match) => match.status === "completed" || match.status === "bye").length;

  const updates = useMemo(() => [...matches]
    .filter((match) => match.status === "completed" || match.status === "live" || match.status === "bye")
    .map((match) => {
      const home = entryName(match.home_entry_id ? entryById.get(match.home_entry_id) : null) || "TBD";
      const away = entryName(match.away_entry_id ? entryById.get(match.away_entry_id) : null) || "TBD";
      const score = matchScore(match);
      const label = match.status === "bye" ? `${home} advances on a bye` : match.status === "live" ? `${home} vs ${away} is live` : `${home} defeated ${away}${score ? ` ${score[0]}–${score[1]}` : ""}`;
      return { id: match.id, label, round: roundLabel(match.round_number, totalRounds), time: matchTime(match), status: match.status };
    })
    .sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime())
    .slice(0, 14), [matches, entryById, totalRounds]);

  const fitToScreen = () => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const scale = Math.min(viewport.clientWidth / content.scrollWidth, viewport.clientHeight / content.scrollHeight, 1);
    setZoom(Math.max(ZOOM_MIN, scale));
  };

  useEffect(() => {
    if (!presentationFullscreen && !fullscreen) return;
    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      if (!viewport || !content) return;
      const scale = Math.min(viewport.clientWidth / content.scrollWidth, viewport.clientHeight / content.scrollHeight, 1);
      setZoom(Math.max(ZOOM_MIN, scale));
      viewport.scrollTo({ top: 0, left: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [divisionId, fullscreen, matches.length, presentationFullscreen]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (viewportRef.current?.closest(".competition-monitor")) void viewportRef.current.closest(".competition-monitor")!.requestFullscreen().catch(() => undefined);
  };

  if (!competition) return <Empty title="Competition not found" detail="This competition may have been removed or belongs to another venue." />;

  return <div className="competition-monitor">
    <header className="competition-monitor-head">
      <div className="competition-monitor-brand"><span><Radio size={18} /></span><div><p>PEAKLE · LIVE {titleCase(competition.kind || "competition")}</p><h2>{competition.name}</h2></div></div>
      <div className="competition-monitor-head-status"><span className={liveMatches ? "is-live" : ""}><i /> {liveMatches ? `${liveMatches} live` : "Live board"}</span><small>{completedMatches} of {matches.length} matches decided</small></div>
      <button className="mini-button" type="button" onClick={toggleFullscreen}>{fullscreen || presentationFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />} {fullscreen || presentationFullscreen ? "Exit full screen" : "Full screen"}</button>
    </header>
    <div className="competition-monitor-switchers">
      {displaySettings}
      <SelectControl value={competitionId} options={competitions.map((item) => ({ value: item.id, label: item.name, detail: titleCase(item.kind || "competition") }))} onChange={(value) => { if (value) router.push(`/competitions/${value}/monitor`); }} ariaLabel="Competition" className="competition-switch" />
      <SelectControl value={divisionId} options={(divisions || []).map((item) => ({ value: item.id, label: item.name, detail: `${titleCase(item.skill_category || "open")} · ${titleCase(item.format || "doubles")}` }))} onChange={(value) => setSelectedDivisionId(value)} ariaLabel="Division" disabled={!divisions?.length} className="division-switch" />
    </div>
    {error ? <Empty title="Could not load the bracket" detail={error} /> : divisions === null ? <div className="bracket-empty"><Trophy size={26} /><strong>Loading bracket…</strong></div> : !divisions.length ? <Empty title="No divisions yet" detail="Add a division to this competition to build its bracket." /> : <div className="competition-monitor-body">
      <section className="bracket-panel">
        <div className="bracket-panel-controls">
          <div className="bracket-panel-title"><span><Sparkles size={14} /></span><div><p>LIVE BRACKET</p><strong>{division?.name || "Competition bracket"}</strong></div><small>{titleCase(division?.format || "doubles")} · {entryById.size} entrants · {totalRounds} rounds</small></div>
          <div className="bracket-zoom-tools">
            <button className="icon-button" type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - 0.1))}><ZoomOut size={16} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button className="icon-button" type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + 0.1))}><ZoomIn size={16} /></button>
            <button className="mini-button" type="button" onClick={fitToScreen}><RotateCcw size={13} /> Fit</button>
          </div>
        </div>
        <div className="bracket-viewport" ref={viewportRef}>
          <div className="bracket-canvas" ref={contentRef} style={{ transform: `scale(${zoom})` }}>
            <BracketTree matches={matches} entryById={entryById} />
          </div>
        </div>
      </section>
      <aside className="card monitor-next-match">
        <p className="eyebrow">NEXT MATCH</p>
        {nextMatch ? <>
          <h3>{roundLabel(nextMatch.round_number, totalRounds)}</h3>
          <div className="monitor-next-match-players">
            {[nextMatch.home_entry_id, nextMatch.away_entry_id].map((entryId, index) => {
              const player = entryId ? entryById.get(entryId) : null;
              const label = entryName(player) || "TBD";
              return <Fragment key={index}>
                {index === 1 ? <i>vs</i> : null}
                <div className="monitor-next-match-player">
                  {player ? <ProfileAvatar name={label} photo={player.profiles?.avatar_url} /> : null}
                  <span>{label}</span>
                  {nextMatch.status === "live" && nextMatch.matches?.match_games ? (
                    <div className="monitor-player-scores">
                      {sortedGames(nextMatch).map((game, i) => {
                        const isHigh = index === 0 ? game.home_score > game.away_score : game.away_score > game.home_score;
                        return <strong key={game.id || i} className={isHigh ? "high-score" : ""}>{index === 0 ? game.home_score : game.away_score}</strong>;
                      })}
                    </div>
                  ) : null}
                </div>
              </Fragment>;
            })}
          </div>
          <Status value={nextMatch.status} />
          {nextMatch.status === "live" && nextMatch.last_point ? <PointAnnouncementOverlay key={nextMatch.last_point.id} announcement={nextMatch.last_point} /> : null}
        </> : <p className="monitor-next-match-empty">No upcoming match. Schedule the next ready pairing to fill this slot.</p>}
      </aside>
    </div>}
    <section className="card monitor-updates">
      <p className="eyebrow">MESSAGES · UPDATES</p>
      {updates.length ? <div className="competition-updates-list">{updates.map((update) => <div key={update.id}><span className={update.status === "live" ? "live" : "open"}>{update.round}</span><div><strong>{update.label}</strong></div></div>)}</div> : <p className="monitor-next-match-empty">Finished matches and live updates will appear here.</p>}
    </section>
  </div>;
}
