// Local-only display simulation for the interactive organizer demo.
// Explicit ?demo=1 links work across tabs in the same browser, never the backend.
import { buildDemoOrganizerData, DEMO_COMPETITION_DIVISIONS } from "./demo-data";
import type { DisplayInput, DisplaySetup, ScoreboardMatch, ScoreboardSnapshot, VenueDisplay } from "./scoreboard-types";

const key = "peakle-demo-displays-v1";
const assignmentsKey = "peakle-demo-display-courts-v1";
const token = () => (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
const read = (): VenueDisplay[] => JSON.parse(localStorage.getItem(key) || "[]");
const write = (rows: VenueDisplay[]) => localStorage.setItem(key, JSON.stringify(rows));
const assignments = (): Record<string, string | null> => JSON.parse(localStorage.getItem(assignmentsKey) || "{}");
export const listDemoDisplays = (venueId: string) => read().filter((display) => display.venue_id === venueId);
export function saveDemoDisplay(input: DisplayInput, existing: VenueDisplay | null): VenueDisplay {
  const rows = read();
  const current = existing ? rows.find((row) => row.id === existing.id) : null;
  if (existing && current?.revision !== existing.revision) throw new Error("Display settings changed. Refresh and try again.");
  const display: VenueDisplay = { id: current?.id || crypto.randomUUID(), token: current?.token || token(), enabled: current?.enabled ?? true, revision: (current?.revision || 0) + 1, ...input };
  write([...rows.filter((row) => row.id !== display.id), display]);
  return display;
}
export function resetDemoDisplayLink(display: VenueDisplay, disconnect: boolean) {
  const rows = read();
  const current = rows.find((row) => row.id === display.id);
  if (current?.revision !== display.revision) throw new Error("Display settings changed. Refresh and try again.");
  write(rows.map((row) => row.id === display.id ? { ...row, enabled: !disconnect, revision: row.revision + 1, token: token() } : row));
}
export function deleteDemoDisplay(display: VenueDisplay) {
  const rows = read();
  if (rows.find((row) => row.id === display.id)?.revision !== display.revision) throw new Error("Display settings changed. Refresh and try again.");
  write(rows.filter((row) => row.id !== display.id));
}

function competitionMatches(sourceId: string) {
  const saved = assignments();
  return DEMO_COMPETITION_DIVISIONS.filter((division) => division.competition_id === sourceId).flatMap((division) => {
    const entryName = (id: string | null | undefined) => {
      const entry = division.competition_entries?.find((entry) => entry.id === id);
      return entry?.profiles?.display_name || entry?.teams?.name || "TBD";
    };
    return (division.competition_bracket_matches || []).map((bracket) => {
      const games = [...(bracket.matches?.match_games || [])].sort((a, b) => a.game_number - b.game_number);
      const latest = games.at(-1);
      const match: ScoreboardMatch = { id: bracket.matches?.id || bracket.id, status: bracket.matches?.status || "scheduled", home: entryName(bracket.home_entry_id), away: entryName(bracket.away_entry_id), home_score: latest?.home_score ?? null, away_score: latest?.away_score ?? null, game: latest?.game_number || 1, games };
      return { bracket, divisionId: division.id, match, courtId: Object.hasOwn(saved, match.id) ? saved[match.id] : match.status === "live" ? "demo-court-2" : null };
    });
  });
}

export function demoDisplaySetup(kind: DisplayInput["source_kind"], sourceId: string, venueId: string): DisplaySetup {
  const data = buildDemoOrganizerData();
  if (kind === "open_play") return { courts: data.liveCourts.filter((court) => court.session_id === sourceId).map((court) => ({ id: court.id, name: court.venue_court?.name || `Court ${court.court_number}` })), divisions: [], matches: [] };
  return {
    courts: (data.venues.find((venue) => venue.id === venueId)?.courts || []).filter((court) => court.active).map((court) => ({ id: court.id, name: court.name })),
    divisions: DEMO_COMPETITION_DIVISIONS.filter((division) => division.competition_id === sourceId).map((division) => ({ id: division.id, name: division.name })),
    matches: competitionMatches(sourceId).filter((entry) => entry.match.status !== "completed").map(({ match, courtId }) => ({ id: match.id, court_id: courtId, status: match.status, label: `${match.home} vs ${match.away}` })),
  };
}
export function assignDemoDisplayCourt(match: DisplaySetup["matches"][number], court: string | null) {
  const saved = assignments();
  if (Object.hasOwn(saved, match.id) && saved[match.id] !== match.court_id) throw new Error("Court assignment changed. Refresh and try again.");
  localStorage.setItem(assignmentsKey, JSON.stringify({ ...saved, [match.id]: court }));
}

export function demoScoreboard(displayToken: string): ScoreboardSnapshot | { available: false } {
  const display = read().find((row) => row.token === displayToken && row.enabled);
  if (!display) return { available: false };
  const data = buildDemoOrganizerData();
  const event = display.source_kind === "open_play" ? data.sessions.find((event) => event.id === display.source_id) : data.competitions.find((event) => event.id === display.source_id);
  if (!event) return { available: false };
  const division = DEMO_COMPETITION_DIVISIONS.find((item) => item.id === display.division_id);
  const snapshot: ScoreboardSnapshot = { available: true, fetched_at: new Date().toISOString(), display: { id: display.id, name: `Demo · ${display.name}`, mode: display.mode, revision: display.revision }, event: { name: event.name, status: event.status || "active", kind: "Demo", division: division?.name || null }, courts: [], standings: [], bracket: [] };
  if (display.source_kind === "open_play") {
    snapshot.courts = data.liveCourts.filter((court) => court.session_id === display.source_id && (display.mode === "all_courts" || court.id === display.court_id)).map((court) => {
      const match = court.open_play_matches?.find((match) => match.status === "live");
      const name = (side: number) => match?.open_play_match_players?.filter((player) => player.side === side).map((player) => player.open_play_players?.profiles?.display_name || player.open_play_players?.guest_name || "Player").join(" + ") || "Players";
      return { id: court.id, name: court.venue_court?.name || `Court ${court.court_number}`, match: match ? { id: match.id, status: "live", home: name(0), away: name(1), home_score: match.home_score ?? 0, away_score: match.away_score ?? 0, game: 1, games: [] } : null };
    });
  } else {
    const matches = competitionMatches(display.source_id).filter((entry) => !display.division_id || entry.divisionId === display.division_id);
    if (display.mode === "court" || display.mode === "all_courts") snapshot.courts = demoDisplaySetup("competition", display.source_id, display.venue_id).courts.filter((court) => display.mode === "all_courts" || court.id === display.court_id).map((court) => ({ ...court, match: matches.find((entry) => entry.courtId === court.id && entry.match.status !== "completed")?.match || null }));
    if (display.mode === "bracket") snapshot.bracket = matches.map(({ match, bracket }) => ({ id: bracket.id, round: bracket.round_number, position: bracket.position, status: bracket.status, home: match.home, away: match.away, winner_side: bracket.winner_entry_id ? bracket.winner_entry_id === bracket.home_entry_id ? 0 : 1 : null, match }));
    if (display.mode === "standings") snapshot.standings = (division?.competition_entries || []).map((entry) => ({ id: entry.id, name: entry.profiles?.display_name || entry.teams?.name || "Player", played: entry.played || 0, won: entry.won || 0, lost: entry.lost || 0, points: entry.standing_points || 0 })).sort((a, b) => b.points - a.points || b.won - a.won);
  }
  return snapshot;
}
