"use client";

import Link from "next/link";
import { Archive, ArchiveRestore, CalendarClock, ChevronLeft, ShieldCheck, Trash2, Users, Swords } from "lucide-react";
import type { OpenPlaySession } from "@/lib/types";
import { dateTime, Empty, money, Status } from "../components/portal-ui";
import type { SessionLifecycleAction } from "../dialogs/session-lifecycle-dialog";

type Props = {
  sessions: OpenPlaySession[];
  onManage: (action: SessionLifecycleAction, sessionId: string) => void;
};

const deletionBlockers = (session: OpenPlaySession) => {
  const blockers: string[] = [];
  if (Number(session.match_count || 0) > 0) blockers.push(`${session.match_count} match record${session.match_count === 1 ? "" : "s"}`);
  if (Number(session.fee_amount || 0) > 0) blockers.push("paid-session history");
  return blockers;
};

export function ArchivedOpenPlay({ sessions, onManage }: Props) {
  return <section className="archive-manager" aria-labelledby="archive-manager-title">
    <div className="section-command-bar archive-command-bar">
      <div>
        <span className="command-icon"><Archive size={18} /></span>
        <div className="archive-command-copy">
          <p className="eyebrow">OPEN PLAY ARCHIVE</p>
          <h2 id="archive-manager-title">Archived sessions</h2>
          <p>Restore a session or remove a free session with no recorded matches.</p>
        </div>
      </div>
      <div><Link className="button button-ghost inline-action" href="/open-play"><ChevronLeft size={16} />Back to sessions</Link></div>
    </div>
    {sessions.length ? <div className="archive-list">{sessions.map((session) => {
      const blockers = deletionBlockers(session);
      const canDelete = blockers.length === 0;
      const playerCount = Number(session.player_count || 0);
      return <article className="card archive-row" key={session.id}>
        <span className="archive-row-icon"><Archive size={20} /></span>
        <div className="archive-row-main">
          <div className="archive-row-heading"><div><small>{session.session_code || "NO SESSION CODE"}</small><h3>{session.name}</h3></div><Status value={session.status} /></div>
          <div className="archive-meta">
            <span><CalendarClock size={14} />{dateTime(session.scheduled_start)}</span>
            <span><Users size={14} />{session.player_count || 0} players</span>
            <span><Swords size={14} />{session.match_count || 0} matches</span>
            <span>{money(session.fee_amount)} fee</span>
          </div>
          {canDelete ? <p className="archive-delete-ready"><Trash2 size={14} />{playerCount ? `Deleting also removes ${playerCount} player registration${playerCount === 1 ? "" : "s"}.` : "This empty session can be permanently deleted."}</p> : <p className="archive-protected"><ShieldCheck size={14} />Deletion is unavailable because this session has {blockers.join(", ")}.</p>}
        </div>
        <div className="archive-actions">
          <button className="button button-ghost" type="button" onClick={() => onManage("restore", session.id)}><ArchiveRestore size={16} />Restore</button>
          <button className="button button-danger" type="button" disabled={!canDelete} title={canDelete ? "Permanently delete this session and its registrations" : `Cannot delete: ${blockers.join(", ")}`} onClick={() => onManage("delete", session.id)}><Trash2 size={16} />Delete</button>
        </div>
      </article>;
    })}</div> : <Empty title="Archive is empty" detail="Completed or cancelled sessions you archive will appear here. Their operational history remains protected." />}
  </section>;
}
