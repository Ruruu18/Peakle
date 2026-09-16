import { requireSupabase } from "./supabase";
import { withTimeout } from "./async";
import type { DisplayInput, DisplaySetup, ScoreboardSnapshot, VenueDisplay } from "./scoreboard-types";
import { isDemoModeActive } from "./demo-mode";
import { assignDemoDisplayCourt, deleteDemoDisplay, demoDisplaySetup, demoScoreboard, listDemoDisplays, resetDemoDisplayLink, saveDemoDisplay } from "./demo-displays";

export const DISPLAY_POLL_MS = 2000;
export const displayLink = (token: string) => `${window.location.origin}/display${isDemoModeActive() ? "?demo=1" : ""}#${token}`;

function fail(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code || "")) {
    throw new Error("Display management is not available yet. Contact your administrator to finish setup.");
  }
  throw new Error(error.message);
}

export async function listDisplays(venueId: string): Promise<VenueDisplay[]> {
  if (isDemoModeActive()) return listDemoDisplays(venueId);
  const { data, error } = await withTimeout(requireSupabase().from("venue_displays").select("*").eq("venue_id", venueId).order("created_at"), 10000, "Displays could not be loaded. Check your connection.");
  fail(error);
  return data || [];
}

export async function saveDisplay(input: DisplayInput, existing: VenueDisplay | null): Promise<VenueDisplay> {
  if (isDemoModeActive()) return saveDemoDisplay(input, existing);
  const { data, error } = await withTimeout(requireSupabase().rpc("save_venue_display", {
    p_id: existing?.id || null, p_expected_revision: existing?.revision ?? null,
    p_venue_id: input.venue_id, p_name: input.name, p_source_kind: input.source_kind,
    p_source_id: input.source_id, p_mode: input.mode, p_court_id: input.court_id, p_division_id: input.division_id,
  }), 10000, "Saving took too long. Refresh displays before trying again.");
  fail(error);
  return data as VenueDisplay;
}

export async function resetDisplayLink(display: VenueDisplay, disconnect: boolean): Promise<void> {
  if (isDemoModeActive()) return resetDemoDisplayLink(display, disconnect);
  const { error } = await withTimeout(requireSupabase().rpc("reset_venue_display_link", { p_id: display.id, p_expected_revision: display.revision, p_disconnect: disconnect }), 10000, "The display could not be updated. Refresh before trying again.");
  fail(error);
}

export async function deleteDisplay(display: VenueDisplay): Promise<void> {
  if (isDemoModeActive()) return deleteDemoDisplay(display);
  const { error } = await withTimeout(requireSupabase().rpc("delete_venue_display", { p_id: display.id, p_expected_revision: display.revision }), 10000, "Deleting took too long. Refresh displays before trying again.");
  fail(error);
}

export async function loadDisplaySetup(kind: DisplayInput["source_kind"], sourceId: string, venueId: string): Promise<DisplaySetup> {
  if (isDemoModeActive()) return demoDisplaySetup(kind, sourceId, venueId);
  const { data, error } = await requireSupabase().rpc("get_venue_display_setup", { p_venue_id: venueId, p_source_kind: kind, p_source_id: sourceId });
  fail(error);
  return data as DisplaySetup;
}

export async function assignDisplayCourt(match: DisplaySetup["matches"][number], courtId: string | null) {
  if (isDemoModeActive()) return assignDemoDisplayCourt(match, courtId);
  const { error } = await requireSupabase().rpc("assign_competition_display_court", { p_match_id: match.id, p_court_id: courtId, p_expected_court_id: match.court_id });
  fail(error);
}

// The TV never uses the organizer's session, even when opened in their browser.
export async function fetchScoreboard(token: string, signal: AbortSignal): Promise<ScoreboardSnapshot | { available: false }> {
  if (new URLSearchParams(window.location.search).get("demo") === "1") return demoScoreboard(token);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Scoreboards are not configured.");
  const response = await fetch(`${url}/rest/v1/rpc/get_scoreboard_display`, {
    method: "POST", cache: "no-store", signal,
    headers: { apikey: key, "Content-Type": "application/json", ...(key.startsWith("sb_publishable_") ? {} : { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ p_token: token }),
  });
  if (!response.ok) throw new Error("The scoreboard could not be refreshed.");
  return response.json();
}
