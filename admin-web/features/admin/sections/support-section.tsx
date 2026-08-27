"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge, ConfirmDialog, Drawer, Tabs } from "@/components/admin-ui";
import { requireSupabase } from "@/lib/supabase";
import {
  closeSupportConversation,
  fetchSupportConversationDetail,
  fetchSupportConversations,
  fetchSupportMessages,
  sendSupportAgentMessage,
} from "@/lib/admin-data";
import { useAuth } from "@/components/providers";
import type { SupportConversation, SupportConversationDetail, SupportConversationStatus, SupportMessage } from "@/lib/types";

const TABS: { id: string; label: string; status?: SupportConversationStatus }[] = [
  { id: "all", label: "All" },
  { id: "bot", label: "AI", status: "bot" },
  { id: "open", label: "Open", status: "open" },
  { id: "assigned", label: "Assigned", status: "assigned" },
  { id: "closed", label: "Closed", status: "closed" },
];
const TYPING_EXPIRY_MS = 2600;

const formatDateTime = (value: string | null) => value
  ? new Date(value).toLocaleString("en-AU", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  : "—";

export default function SupportSection() {
  const { user } = useAuth();
  const [tab, setTab] = useState("all");
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SupportConversation | null>(null);
  const [detail, setDetail] = useState<SupportConversationDetail | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [closeTarget, setCloseTarget] = useState<SupportConversation | null>(null);
  const [closing, setClosing] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof requireSupabase>["channel"]> | null>(null);

  const activeStatus = TABS.find((item) => item.id === tab)?.status;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConversations(await fetchSupportConversations(activeStatus));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load conversations.");
    } finally {
      setLoading(false);
    }
  }, [activeStatus]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const supabase = requireSupabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queueRefresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 350); };
    const channel = supabase.channel("admin-support-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, queueRefresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages" }, queueRefresh)
      .subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [load]);

  const loadDetail = useCallback(async (conversationId: string) => {
    try {
      setDetail(await fetchSupportConversationDetail(conversationId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load conversation.");
    }
  }, []);

  const openConversation = async (conversation: SupportConversation) => {
    setSelected(conversation);
    void loadDetail(conversation.conversation_id);
    try {
      setMessages(await fetchSupportMessages(conversation.conversation_id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load messages.");
    }
  };

  useEffect(() => {
    if (!selected) { channelRef.current = null; return; }
    const conversationId = selected.conversation_id;
    const supabase = requireSupabase();
    let typingExpiry: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase.channel(`admin-support-${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages", filter: `conversation_id=eq.${conversationId}` }, () => {
        void fetchSupportMessages(conversationId).then(setMessages).catch(() => {});
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "support_conversations", filter: `id=eq.${conversationId}` }, () => void loadDetail(conversationId))
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.userId === user?.id) return;
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
      void supabase.removeChannel(channel);
    };
  }, [selected, loadDetail, user?.id]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const notifyTyping = (hasText: boolean) => {
    channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: user?.id, isTyping: hasText } }).catch(() => {});
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean || sending || !selected) return;
    notifyTyping(false);
    setSending(true);
    try {
      await sendSupportAgentMessage(selected.conversation_id, clean);
      setDraft("");
      setMessages(await fetchSupportMessages(selected.conversation_id));
      void loadDetail(selected.conversation_id);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Message not sent.");
    } finally {
      setSending(false);
    }
  };

  const confirmClose = async () => {
    if (!closeTarget) return;
    setClosing(true);
    try {
      await closeSupportConversation(closeTarget.conversation_id);
      toast.success("Conversation closed.");
      const closedId = closeTarget.conversation_id;
      setCloseTarget(null);
      if (selected?.conversation_id === closedId) setSelected(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to close conversation.");
    } finally {
      setClosing(false);
    }
  };

  const lastRequesterMessageAt = [...messages].reverse().find((message) => message.sender_type === "user")?.created_at;
  const requesterSeen = detail?.requester_last_read_at && lastRequesterMessageAt
    && new Date(detail.requester_last_read_at) >= new Date(lastRequesterMessageAt);

  return (
    <div className="section-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">CUSTOMER SUPPORT</p>
          <h1>Support</h1>
          <p>Conversations Peakle AI couldn&apos;t resolve, or that a player or organizer asked to escalate.</p>
        </div>
      </div>

      <Tabs tabs={TABS.map(({ id, label }) => ({ id, label }))} active={tab} onChange={setTab} />

      <div className="card" style={{ marginTop: 16 }}>
        {loading ? (
          <div className="table-loading">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="table-skeleton-row">
                <div className="skeleton" style={{ width: "34px", height: "34px", borderRadius: "50%" }} />
                <div className="skeleton" style={{ flex: 1, height: "13px" }} />
                <div className="skeleton" style={{ width: "100px", height: "13px" }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Requester</th>
                  <th>Status</th>
                  <th>Last message</th>
                  <th>Rating</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {conversations.length === 0 ? (
                  <tr><td colSpan={5} className="data-table-empty">No conversations.</td></tr>
                ) : (
                  conversations.map((conversation) => (
                    <tr
                      key={conversation.conversation_id}
                      className="data-table-row-clickable"
                      onClick={() => void openConversation(conversation)}
                    >
                      <td>
                        <div className="user-cell">
                          <div className="avatar avatar-sm">
                            {(conversation.requester_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                          </div>
                          <span className="user-name">{conversation.requester_name}</span>
                        </div>
                      </td>
                      <td><Badge status={conversation.status} /></td>
                      <td>{conversation.last_body || "No messages yet"}</td>
                      <td>{conversation.csat_rating ? `${conversation.csat_rating}/5` : "—"}</td>
                      <td>{formatDateTime(conversation.last_message_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.requester_name || "Conversation"}>
        {selected ? (
          <>
            <div className="support-drawer-meta">
              <Badge status={selected.status} />
              {selected.category ? <span className="table-secondary">{selected.category}</span> : null}
              {detail?.csat_rating ? (
                <span className="table-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  <Star size={13} color="var(--optic)" fill="var(--optic)" /> {detail.csat_rating}/5
                </span>
              ) : null}
              {selected.status !== "closed" ? (
                <button className="button button-ghost" type="button" onClick={() => setCloseTarget(selected)}>Close conversation</button>
              ) : null}
            </div>
            <div className="support-thread-messages" ref={messagesRef}>
              {messages.map((message) => {
                const mine = message.sender_type === "agent" && message.sender_id === user?.id;
                return (
                  <div key={message.id} className={`support-message${mine ? " mine" : ""}`}>
                    {!mine ? (
                      <span className={`support-sender-label${message.sender_type === "ai" ? " ai" : ""}`}>
                        {message.sender_type === "ai" ? "Peakle AI" : message.sender_type === "agent" ? message.profiles?.display_name || "Teammate" : selected.requester_name}
                      </span>
                    ) : null}
                    <div className="support-bubble">
                      {message.media_url ? <img src={message.media_url} alt="Attachment" style={{ display: "block", maxWidth: 220, borderRadius: 10, marginBottom: message.body ? 6 : 0 }} /> : null}
                      {message.body}
                      <div className="support-bubble-time">{formatDateTime(message.created_at)}</div>
                    </div>
                  </div>
                );
              })}
              {(() => {
                const lastMine = [...messages].reverse().find((message) => message.sender_type === "agent" && message.sender_id === user?.id);
                return lastMine && requesterSeen ? <span className="table-secondary" style={{ alignSelf: "flex-end" }}>Seen by {selected.requester_name}</span> : null;
              })()}
              {remoteTyping ? <p className="table-secondary">{selected.requester_name} is typing…</p> : null}
            </div>
            <form className="support-composer" onSubmit={send}>
              <textarea
                value={draft}
                onChange={(event) => { setDraft(event.target.value); notifyTyping(Boolean(event.target.value.trim())); }}
                onBlur={() => notifyTyping(false)}
                placeholder="Reply as Peakle support"
                maxLength={4000}
              />
              <button className="button button-accent" type="submit" disabled={!draft.trim() || sending}><Send size={15} /></button>
            </form>
          </>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={!!closeTarget}
        title="Close this conversation?"
        message="The requester can still reopen it by sending another message."
        confirmLabel={closing ? "Closing…" : "Close conversation"}
        onConfirm={confirmClose}
        onCancel={() => setCloseTarget(null)}
      />
    </div>
  );
}
