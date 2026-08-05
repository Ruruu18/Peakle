"use client";

import { Archive, ArchiveRestore, Check, OctagonX, Play, Square, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { OpenPlaySession } from "@/lib/types";
import { dateTime } from "../components/portal-ui";

export type SessionLifecycleAction = "start" | "cancel" | "end" | "archive" | "restore" | "delete";

const actionCopy = {
  start: {
    eyebrow: "START OPEN PLAY",
    title: "Start this session?",
    detail: "The live monitor will open and staff can begin assigning checked-in players to courts. Matches still require lineup confirmation.",
    confirm: "Start session",
    busy: "Starting…",
    success: "Open Play is live.",
    icon: Play,
  },
  cancel: {
    eyebrow: "CANCEL OPEN PLAY",
    title: "Cancel this session?",
    detail: "Registration will close and registered players will be notified. Session history remains available for records.",
    confirm: "Cancel session",
    busy: "Cancelling…",
    success: "Open Play cancelled.",
    icon: OctagonX,
  },
  end: {
    eyebrow: "END LIVE SESSION",
    title: "End this session?",
    detail: "Live play will stop and the session will be marked completed. Scores, players, and rotation history are preserved.",
    confirm: "End session",
    busy: "Ending…",
    success: "Open Play ended.",
    icon: Square,
  },
  archive: {
    eyebrow: "ARCHIVE OPEN PLAY",
    title: "Archive this session?",
    detail: "It will disappear from the organizer schedule while registrations, scores, and audit history remain stored.",
    confirm: "Archive session",
    busy: "Archiving…",
    success: "Open Play archived.",
    icon: Archive,
  },
  restore: {
    eyebrow: "RESTORE OPEN PLAY",
    title: "Restore this session?",
    detail: "The session will return to Open Play history with its registrations, scores, and original status intact.",
    confirm: "Restore session",
    busy: "Restoring…",
    success: "Open Play restored.",
    icon: ArchiveRestore,
  },
  delete: {
    eyebrow: "PERMANENTLY DELETE",
    title: "Delete this session forever?",
    detail: "This cannot be undone. The session, court setup, and player registrations will be permanently removed. Sessions with match or paid history remain protected.",
    confirm: "Delete permanently",
    busy: "Deleting…",
    success: "Archived Open Play permanently deleted.",
    icon: Trash2,
  },
} satisfies Record<SessionLifecycleAction, { eyebrow: string; title: string; detail: string; confirm: string; busy: string; success: string; icon: typeof Archive }>;

export function SessionLifecycleDialog({ session, action, onClose, onComplete }: { session: OpenPlaySession; action: SessionLifecycleAction; onClose: () => void; onComplete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const startsEarly = action === "start" && Boolean(session.scheduled_start && new Date(session.scheduled_start) > new Date());
  const copy = startsEarly ? {
    ...actionCopy.start,
    title: "Start this session early?",
    detail: `This session is scheduled for ${dateTime(session.scheduled_start)}. Starting now opens live court operations immediately; matches still require lineup confirmation.`,
    confirm: "Start early",
  } : actionCopy[action];
  const Icon = copy.icon;
  const confirm = async () => {
    setBusy(true);
    try {
      const client = requireSupabase();
      const result = await client.rpc("manage_open_play_session", { p_session_id: session.id, p_action: action });
      let error = result.error;
      // Older deployments blocked free sessions merely for having registrations.
      // The direct delete uses the existing owner-only RLS policy and FK cascades.
      if (error && action === "delete" && /player records must be retained/i.test(error.message) && Number(session.match_count || 0) === 0 && Number(session.fee_amount || 0) === 0) {
        const { data: deleted, error: deleteError } = await client.from("open_play_sessions").delete().eq("id", session.id).not("archived_at", "is", null).select("id").maybeSingle();
        if (deleteError) throw deleteError;
        if (!deleted) throw new Error("The archived session could not be deleted. Refresh and try again.");
        error = null;
      }
      if (error && (action === "cancel" || action === "end") && ["42883", "PGRST202"].includes(error.code || "")) {
        const nextStatus = action === "cancel" ? "cancelled" : "completed";
        const { data: updated, error: fallbackError } = await client.from("open_play_sessions").update({ status: nextStatus, ended_at: new Date().toISOString() }).eq("id", session.id).select("id").maybeSingle();
        if (fallbackError) throw fallbackError;
        if (!updated) throw new Error("The session could not be updated. Refresh and try again.");
      } else if (error) {
        if (action === "start" && ["42703", "42883", "PGRST202"].includes(error.code || "")) throw new Error("Explicit session starting is ready in the web app, but its Supabase migration still needs to be applied.");
        if (["archive", "restore", "delete"].includes(action) && ["42883", "PGRST202"].includes(error.code || "")) throw new Error("Archive management is ready in the web app, but its Supabase migration still needs to be applied.");
        throw error;
      }
      toast.success(copy.success);
      await onComplete();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "The session could not be updated."); }
    finally { setBusy(false); }
  };
  const destructive = action !== "restore" && action !== "start";
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}><div className="dialog session-lifecycle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="session-lifecycle-title" aria-describedby="session-lifecycle-detail"><div className="dialog-head"><div><p className="eyebrow">{copy.eyebrow}</p><h2 id="session-lifecycle-title">{copy.title}</h2></div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button></div><div className={`lifecycle-warning ${action === "delete" ? "permanent" : ""}`}><span><Icon size={22} /></span><div><strong>{session.name}</strong><p id="session-lifecycle-detail">{copy.detail}</p></div></div><div className="dialog-actions"><button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>{action === "restore" || action === "delete" ? "Keep archived" : "Keep session"}</button><button className={`button ${destructive ? "button-danger" : "button-accent"}`} type="button" onClick={() => void confirm()} disabled={busy}>{busy ? copy.busy : copy.confirm}<Check size={16} /></button></div></div></div>;
}
