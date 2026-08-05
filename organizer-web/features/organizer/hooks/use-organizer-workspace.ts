"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/async";
import { loadOrganizerData } from "@/lib/organizer-data";
import { getSupabase } from "@/lib/supabase";
import type { OrganizerData } from "@/lib/types";

const CACHE_FRESHNESS_MS = 30_000;
let workspaceCache: { userId: string; venueId: string | null; data: OrganizerData; loadedAt: number } | null = null;

export function useOrganizerWorkspace(user: User | null) {
  const cached = workspaceCache?.userId === user?.id ? workspaceCache : null;
  const [data, setData] = useState<OrganizerData | null>(() => cached?.data ?? null);
  const [loading, setLoading] = useState(() => !cached);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [venueId, setVenueId] = useState<string | null>(() => cached?.venueId ?? null);
  const requestVersion = useRef(0);
  const visibleRequestVersion = useRef(0);

  const fetchWorkspace = useCallback(async (showActivity: boolean) => {
    if (!user) { setLoading(false); return; }
    const version = ++requestVersion.current;
    if (showActivity) {
      visibleRequestVersion.current = version;
      setLoading(true);
      setRefreshing(true);
    }
    setError("");
    try {
      const result = await withTimeout(loadOrganizerData(user, venueId), 15_000, "The workspace took too long to respond. Check your connection and try again.");
      if (version !== requestVersion.current) return;
      setData(result);
      workspaceCache = { userId: user.id, venueId, data: result, loadedAt: Date.now() };
      if (venueId && !result.venues.some((venue) => venue.id === venueId)) setVenueId(null);
    } catch (reason) {
      if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : "The organizer workspace could not be loaded.");
    } finally {
      if (showActivity && visibleRequestVersion.current === version) { setLoading(false); setRefreshing(false); }
    }
  }, [user, venueId]);

  const refresh = useCallback(() => fetchWorkspace(false), [fetchWorkspace]);
  const hardRefresh = useCallback(() => fetchWorkspace(true), [fetchWorkspace]);

  useEffect(() => {
    const cache = workspaceCache;
    if (cache && cache.userId === user?.id && cache.venueId === venueId && Date.now() - cache.loadedAt < CACHE_FRESHNESS_MS) return;
    const timer = setTimeout(() => { void (data ? refresh() : hardRefresh()); }, 0);
    return () => clearTimeout(timer);
  }, [data, hardRefresh, refresh, user?.id, venueId]);

  useEffect(() => {
    if (!user) return;
    const client = getSupabase();
    if (!client) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queueRefresh = () => { clearTimeout(timer); timer = setTimeout(refresh, 350); };
    const channel = client.channel(`organizer-web-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "open_play_sessions" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "open_play_players" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "open_play_matches" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "open_play_match_players" }, queueRefresh)
      .subscribe();
    return () => { clearTimeout(timer); void client.removeChannel(channel); };
  }, [refresh, user]);

  return { data, loading, refreshing, error, venueId, setVenueId, refresh, hardRefresh };
}
