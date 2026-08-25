"use client";

import { History, ListX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { requireSupabase } from "@/lib/supabase";
import type { OpenPlayScoreEvent } from "@/lib/types";

const eventTime = (value: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));

const eventLabel = (event: OpenPlayScoreEvent, homeName: string, awayName: string) => {
  const side = event.rally_winner_side === 0 ? homeName : event.rally_winner_side === 1 ? awayName : null;
  if (event.action === "point") return `Point · ${side}`;
  if (event.action === "second_server") return "Second server";
  if (event.action === "side_out") return "Side out";
  if (event.action === "undo") return "Rally undone";
  return "Score update";
};

export function MatchHistoryDialog({ matchId, homeName, awayName, onClose }: { matchId: string; homeName: string; awayName: string; onClose: () => void }) {
  const [events, setEvents] = useState<OpenPlayScoreEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: queryError } = await requireSupabase()
        .from("open_play_score_events")
        .select("id, match_id, action, rally_winner_side, home_score, away_score, created_at, undone_at")
        .eq("match_id", matchId)
        .order("id", { ascending: false });
      if (cancelled) return;
      if (queryError) setError(queryError.message || "The match history could not be loaded.");
      else setEvents((data || []) as OpenPlayScoreEvent[]);
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog match-history-dialog" role="dialog" aria-modal="true" aria-labelledby="match-history-title">
      <div className="dialog-head">
        <div><p className="eyebrow">RALLY-BY-RALLY</p><h2 id="match-history-title">Match history</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      {error ? <div className="monitor-side-empty"><ListX size={24} /><strong>Could not load history</strong><span>{error}</span></div>
        : events === null ? <div className="monitor-side-empty"><History size={24} /><strong>Loading…</strong></div>
        : events.length === 0 ? <div className="monitor-side-empty"><History size={24} /><strong>No rallies recorded yet</strong><span>Points will appear here as the assigned scorer records them.</span></div>
        : <div className="monitor-status-list match-history-list">{events.map((event) => <div key={event.id} className={event.undone_at ? "undone" : ""}>
            <span className={event.action === "undo" ? "" : "live"}>{event.action === "undo" ? "↺" : `${event.home_score}–${event.away_score}`}</span>
            <div><strong>{eventLabel(event, homeName, awayName)}</strong><small>{eventTime(event.created_at)}{event.undone_at ? " · later undone" : ""}</small></div>
          </div>)}</div>}
    </div>
  </div>;
}
