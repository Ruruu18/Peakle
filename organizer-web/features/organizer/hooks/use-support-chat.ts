"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import { deleteSupportChatMedia, signSupportChatMedia, uploadSupportChatMedia, type SupportMediaAttachment } from "@/lib/support-media";

export type SupportConversationSummary = {
  conversation_id: string;
  status: "bot" | "open" | "assigned" | "closed";
  category: string | null;
  ai_handled: boolean;
  needs_human: boolean;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  created_at: string;
  last_message_at: string | null;
  last_body: string | null;
  last_sender_type: string | null;
  unread_count: number;
};

export type SupportConversationDetail = {
  conversation_id: string;
  requester_id: string;
  requester_name: string;
  requester_avatar_url: string | null;
  status: "bot" | "open" | "assigned" | "closed";
  category: string | null;
  ai_handled: boolean;
  needs_human: boolean;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  created_at: string;
  last_message_at: string | null;
  requester_last_read_at: string | null;
  agent_last_read_at: string | null;
  csat_rating: number | null;
  csat_comment: string | null;
  csat_submitted_at: string | null;
};

export type SupportMessage = {
  id: string;
  conversation_id: string;
  sender_type: "user" | "ai" | "agent";
  sender_id: string | null;
  body: string;
  media_path: string | null;
  media_url?: string | null;
  created_at: string;
  profiles?: { display_name?: string | null; avatar_url?: string | null } | null;
};

const MESSAGE_SELECT = "id, conversation_id, sender_type, sender_id, body, media_path, created_at, profiles(display_name, avatar_url)";
const TYPING_HEARTBEAT_MS = 900;
const TYPING_IDLE_MS = 1400;
const TYPING_EXPIRY_MS = 2600;

export function useSupportChat() {
  const [conversations, setConversations] = useState<SupportConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<SupportConversationDetail | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [requestingHuman, setRequestingHuman] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof requireSupabase>["channel"]> | null>(null);
  const typingActiveRef = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typingHeartbeatTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const loadConversations = useCallback(async () => {
    const { data, error } = await requireSupabase().rpc("list_support_conversations");
    if (error) { toast.error(error.message); return null; }
    return (data || []) as SupportConversationSummary[];
  }, []);

  const refreshConversations = useCallback(async () => {
    const rows = await loadConversations();
    if (rows) setConversations(rows);
    return rows;
  }, [loadConversations]);

  const loadDetail = useCallback(async (conversationId: string) => {
    const { data, error } = await requireSupabase().rpc("get_support_conversation", { p_conversation_id: conversationId });
    if (error) { toast.error(error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    setSelected((row as SupportConversationDetail) || null);
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const client = requireSupabase();
    const { data, error } = await client
      .from("support_messages")
      .select(MESSAGE_SELECT)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(200);
    if (error) { toast.error(error.message); return; }
    const rows = (data || []) as unknown as SupportMessage[];
    const urls = await signSupportChatMedia(rows.map((row) => row.media_path || "").filter(Boolean));
    setMessages(rows.map((row) => ({ ...row, media_url: row.media_path ? urls.get(row.media_path) || null : null })));
    await client.rpc("mark_support_conversation_read", { p_conversation_id: conversationId });
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const client = requireSupabase();
      const { data: auth } = await client.auth.getUser();
      setUserId(auth.user?.id || null);
      await refreshConversations();
      setLoading(false);
    })();
  }, [refreshConversations]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedId) { void loadDetail(selectedId); void loadMessages(selectedId); }
      else { setSelected(null); setMessages([]); }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedId, loadDetail, loadMessages]);

  const stopTyping = useCallback(() => {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (typingHeartbeatTimer.current) clearInterval(typingHeartbeatTimer.current);
    if (typingActiveRef.current) {
      channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId, isTyping: false } }).catch(() => {});
    }
    typingActiveRef.current = false;
  }, [userId]);

  const notifyTyping = useCallback((hasText: boolean) => {
    const humanPresent = selected?.status === "open" || selected?.status === "assigned";
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (!hasText || !humanPresent || !channelRef.current) { stopTyping(); return; }
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      channelRef.current.send({ type: "broadcast", event: "typing", payload: { userId, isTyping: true } }).catch(() => {});
    }
    if (!typingHeartbeatTimer.current) {
      typingHeartbeatTimer.current = setInterval(() => {
        channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId, isTyping: true } }).catch(() => {});
      }, TYPING_HEARTBEAT_MS);
    }
    typingStopTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [selected?.status, stopTyping, userId]);

  useEffect(() => {
    if (!userId) return;
    const client = requireSupabase();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const queueRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refreshConversations(), 350); };
    const channel = client.channel(`organizer-support-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, () => {
        queueRefresh();
        if (selectedId) void loadMessages(selectedId);
      })
      .subscribe();
    return () => { clearTimeout(refreshTimer); void client.removeChannel(channel); };
  }, [userId, refreshConversations, loadMessages, selectedId]);

  useEffect(() => {
    if (!selectedId || !userId) { channelRef.current = null; return; }
    const client = requireSupabase();
    let typingExpiry: ReturnType<typeof setTimeout> | undefined;
    const channel = client.channel(`support-chat-${selectedId}`)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.userId === userId) return;
        clearTimeout(typingExpiry);
        setRemoteTyping(Boolean(payload.isTyping));
        if (payload.isTyping) typingExpiry = setTimeout(() => setRemoteTyping(false), TYPING_EXPIRY_MS);
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      clearTimeout(typingExpiry);
      setRemoteTyping(false);
      void client.removeChannel(channel);
    };
  }, [selectedId, userId]);
  useEffect(() => () => stopTyping(), [stopTyping]);

  const startConversation = useCallback(async (body: string, category: string | null, file: File | null) => {
    setSending(true);
    let uploaded: SupportMediaAttachment | null = null;
    try {
      if (file) uploaded = await uploadSupportChatMedia(file);
      const { data, error } = await requireSupabase().rpc("start_support_conversation", {
        p_body: body.trim(),
        p_category: category,
        p_media_path: uploaded?.path || null,
        p_media_type: uploaded?.type || null,
        p_media_name: uploaded?.name || null,
        p_media_mime: uploaded?.mime || null,
        p_media_size: uploaded?.size || null,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      await refreshConversations();
      if (result?.conversation_id) {
        setSelectedId(result.conversation_id);
        void requireSupabase().functions.invoke("support-ai-reply", { body: { conversation_id: result.conversation_id } });
      }
      return true;
    } catch (reason) {
      if (uploaded?.path) void deleteSupportChatMedia(uploaded.path);
      toast.error(reason instanceof Error ? reason.message : "Could not start a conversation.");
      return false;
    } finally {
      setSending(false);
    }
  }, [refreshConversations]);

  const sendMessage = useCallback(async (body: string, file: File | null) => {
    if (!selectedId) return false;
    setSending(true);
    stopTyping();
    let uploaded: SupportMediaAttachment | null = null;
    try {
      if (file) uploaded = await uploadSupportChatMedia(file);
      const { error } = await requireSupabase().rpc("send_support_message", {
        p_conversation_id: selectedId,
        p_body: body.trim(),
        p_media_path: uploaded?.path || null,
        p_media_type: uploaded?.type || null,
        p_media_name: uploaded?.name || null,
        p_media_mime: uploaded?.mime || null,
        p_media_size: uploaded?.size || null,
      });
      if (error) throw error;
      await Promise.all([loadMessages(selectedId), refreshConversations(), loadDetail(selectedId)]);
      void requireSupabase().functions.invoke("support-ai-reply", { body: { conversation_id: selectedId } });
      return true;
    } catch (reason) {
      if (uploaded?.path) void deleteSupportChatMedia(uploaded.path);
      toast.error(reason instanceof Error ? reason.message : "Message not sent.");
      return false;
    } finally {
      setSending(false);
    }
  }, [selectedId, loadMessages, refreshConversations, loadDetail, stopTyping]);

  const talkToHuman = useCallback(async () => {
    if (!selectedId || requestingHuman) return;
    setRequestingHuman(true);
    try {
      const { error } = await requireSupabase().rpc("request_human_support", { p_conversation_id: selectedId });
      if (error) throw error;
      await Promise.all([loadDetail(selectedId), refreshConversations()]);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not connect you with a teammate.");
    } finally {
      setRequestingHuman(false);
    }
  }, [selectedId, requestingHuman, loadDetail, refreshConversations]);

  const submitRating = useCallback(async (rating: number, comment: string) => {
    if (!selectedId) return;
    setRatingBusy(true);
    try {
      const { error } = await requireSupabase().rpc("rate_support_conversation", {
        p_conversation_id: selectedId,
        p_rating: rating,
        p_comment: comment || null,
      });
      if (error) throw error;
      await loadDetail(selectedId);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Rating not saved.");
    } finally {
      setRatingBusy(false);
    }
  }, [selectedId, loadDetail]);

  return {
    conversations, selectedId, setSelectedId, selected, messages, loading, sending,
    requestingHuman, ratingBusy, remoteTyping, userId,
    notifyTyping, startConversation, sendMessage, talkToHuman, submitRating,
  };
}
