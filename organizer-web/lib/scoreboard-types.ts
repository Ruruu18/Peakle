export type DisplayMode = "court" | "all_courts" | "bracket" | "standings";
export type VenueDisplay = {
  id: string;
  venue_id: string;
  name: string;
  source_kind: "open_play" | "competition";
  source_id: string;
  mode: DisplayMode;
  court_id: string | null;
  division_id: string | null;
  token: string;
  enabled: boolean;
  revision: number;
};
export type DisplayInput = Omit<VenueDisplay, "id" | "token" | "enabled" | "revision">;
export type ScoreboardMatch = {
  id: string;
  status: string;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  server_side?: number | null;
  service_number?: number | null;
  paused?: boolean;
  game: number;
  games: { game_number: number; home_score: number; away_score: number }[];
};
export type ScoreboardSnapshot = {
  available: true;
  fetched_at: string;
  display: Pick<VenueDisplay, "id" | "name" | "mode" | "revision">;
  event: { name: string; kind: string; status: string; division: string | null };
  courts: { id: string; name: string; match: ScoreboardMatch | null }[];
  bracket: { id: string; round: number; position: number; status: string; home: string; away: string; winner_side: number | null; match: ScoreboardMatch | null }[];
  standings: { id: string; name: string; played: number; won: number; lost: number; points: number }[];
};
export type DisplaySetup = {
  courts: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
  matches: { id: string; court_id: string | null; status: string; label: string }[];
};
