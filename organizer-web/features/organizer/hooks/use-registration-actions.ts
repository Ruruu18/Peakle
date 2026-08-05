"use client";

import { useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { Registration } from "@/lib/types";

export type RegistrationAction = "approve" | "reject" | "checkin";

export function useRegistrationActions(refresh: () => Promise<void>) {
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);

  const act = async (player: Registration, action: RegistrationAction) => {
    setBusyPlayerId(player.id);
    try {
      const client = requireSupabase();
      const request = action === "checkin"
        ? client.rpc("check_in_open_play_player", { p_player_id: player.id })
        : client.rpc("review_open_play_registration", { p_player_id: player.id, p_approve: action === "approve" });
      const { error } = await request;
      if (error) throw error;
      await refresh();
      toast.success(action === "approve" ? "Registration approved." : action === "reject" ? "Registration declined." : "Player checked in.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Player update failed.");
    } finally {
      setBusyPlayerId(null);
    }
  };

  return { act, busyPlayerId };
}
