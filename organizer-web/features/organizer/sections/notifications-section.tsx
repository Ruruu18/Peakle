"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Inbox, Trash2 } from "lucide-react";
import { useAuth } from "@/components/providers";
import { groupForDate, iconForKind, timeLabelFor, type OrganizerNotification } from "@/lib/notifications";
import { useNotifications } from "../hooks/use-notifications";

export function NotificationsSection() {
  const { user } = useAuth();
  const { notifications, loading, unreadCount, readOne, readAll, remove, clearRead } = useNotifications(user);
  const router = useRouter();

  const grouped = useMemo(() => {
    const now = new Date();
    return notifications.map((item) => ({ item, group: groupForDate(new Date(item.created_at), now) }));
  }, [notifications]);

  const clearableCount = notifications.filter((item) => item.read_at).length;

  const openItem = (item: OrganizerNotification) => {
    if (!item.read_at) void readOne(item.id);
    if (item.session_id) router.push(`/open-play/${item.session_id}`);
  };

  return (
    <div className="card notification-card">
      <div className="notification-toolbar">
        <div>
          <strong>{unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}</strong>
          <small>{notifications.length === 1 ? "1 notification" : `${notifications.length} notifications`}</small>
        </div>
        <div className="notification-toolbar-actions">
          {unreadCount > 0 ? <button className="mini-button" type="button" onClick={() => void readAll()}><CheckCheck size={14} /> Read all</button> : null}
          {clearableCount > 0 ? <button className="mini-button" type="button" onClick={() => void clearRead()}><Trash2 size={14} /> Clear read</button> : null}
        </div>
      </div>

      {loading ? (
        <div className="notification-empty"><p>Loading notifications…</p></div>
      ) : notifications.length === 0 ? (
        <div className="notification-empty">
          <span className="empty-icon"><Inbox size={21} /></span>
          <h3>Nothing needs your attention</h3>
          <p>Booking activity, court alerts, and account updates will land here.</p>
        </div>
      ) : (
        <div className="notification-list">
          {grouped.map(({ item, group }, index) => {
            const Icon = iconForKind(item.kind);
            const unread = !item.read_at;
            const showGroupLabel = index === 0 || grouped[index - 1].group !== group;
            return (
              <div key={item.id}>
                {showGroupLabel ? <p className="notification-group-label">{group}</p> : null}
                <div
                  className={`notification-row ${unread ? "unread" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openItem(item)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openItem(item); } }}
                >
                  <span className="notification-icon"><Icon size={16} /></span>
                  <div className="notification-copy">
                    <div className="notification-title-row">
                      <strong>{item.title}</strong>
                      {unread ? <span className="notification-new-pill">NEW</span> : null}
                    </div>
                    <p className="notification-body">{item.body}</p>
                    <span className="notification-time">{timeLabelFor(new Date(item.created_at), group)}</span>
                  </div>
                  <button
                    className="icon-button notification-delete"
                    type="button"
                    aria-label={`Delete notification: ${item.title}`}
                    onClick={(event) => { event.stopPropagation(); void remove(item.id); }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
