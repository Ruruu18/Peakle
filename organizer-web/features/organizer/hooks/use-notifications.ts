"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { isDemoUser } from "@/lib/demo-mode";
import { buildDemoNotifications } from "@/lib/demo-notifications";
import {
  clearReadNotifications,
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type OrganizerNotification,
} from "@/lib/notifications";

export function useNotifications(user: User | null) {
  const demo = isDemoUser(user);
  const [notifications, setNotifications] = useState<OrganizerNotification[]>(() => (demo ? buildDemoNotifications() : []));
  const [loading, setLoading] = useState(!demo);

  const refresh = useCallback(async () => {
    if (!user) { setNotifications([]); setLoading(false); return; }
    if (demo) { setNotifications(buildDemoNotifications()); setLoading(false); return; }
    try {
      setNotifications(await listNotifications());
    } finally {
      setLoading(false);
    }
  }, [user, demo]);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const client = getSupabase();
    if (!client || !user || demo) return;
    const topic = `organizer-notifications-${user.id}`;
    // client.channel() dedupes by topic, so React's dev-mode double effect
    // invocation can hand back a channel that's already joining/joined here.
    // Calling .on() on that would throw, so only subscribe if it's new.
    const existing = client.getChannels().find((c) => c.topic === `realtime:${topic}`);
    const channel = existing ?? client.channel(topic);
    if (!existing) {
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` }, () => { void refresh(); })
        .subscribe();
    }
    return () => { void client.removeChannel(channel); };
  }, [refresh, user, demo]);

  const readOne = useCallback(async (id: string) => {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read_at: new Date().toISOString() } : item)));
    if (demo) return;
    await markNotificationRead(id);
  }, [demo]);

  const readAll = useCallback(async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => (item.read_at ? item : { ...item, read_at: readAt })));
    if (demo) return;
    await markAllNotificationsRead();
  }, [demo]);

  const remove = useCallback(async (id: string) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
    if (demo) return;
    await deleteNotification(id);
  }, [demo]);

  const clearRead = useCallback(async () => {
    setNotifications((current) => current.filter((item) => !item.read_at));
    if (demo) return;
    await clearReadNotifications();
  }, [demo]);

  const unreadCount = notifications.filter((item) => !item.read_at).length;

  return { notifications, loading, unreadCount, refresh, readOne, readAll, remove, clearRead };
}
