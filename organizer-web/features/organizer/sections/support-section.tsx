"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Paperclip, Send, Sparkles, Star, Trash2, UserRound, X } from "lucide-react";
import { Empty, SelectControl } from "../components/portal-ui";
import { SUPPORT_QUICK_REPLIES } from "../config/support-quick-replies";
import { useSupportChat } from "../hooks/use-support-chat";
import { STATUS_LABEL, STATUS_SHORT, formatTime } from "../lib/support-chat-ui";

const SUPPORT_CATEGORIES = ["Booking or payment", "Account access", "Venue operations", "Billing or payouts", "Bug or feedback"];

function CsatCard({ busy, onSubmit }: { busy: boolean; onSubmit: (rating: number, comment: string) => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  return (
    <div className="card notice" style={{ display: "grid", gap: 10 }}>
      <strong>How was your experience?</strong>
      <div style={{ display: "flex", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} type="button" aria-label={`Rate ${value} stars`} className="icon-button" onClick={() => setRating(value)}>
            <Star size={20} color="var(--optic)" fill={value <= rating ? "var(--optic)" : "none"} />
          </button>
        ))}
      </div>
      <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Anything else you'd like to share? (optional)" maxLength={500} />
      <button className="button button-accent" type="button" disabled={!rating || busy} onClick={() => onSubmit(rating, comment)}>
        {busy ? "Submitting…" : "Submit rating"}
      </button>
    </div>
  );
}

export function SupportSection() {
  const chat = useSupportChat();
  const selectedId = chat.selectedId;
  const messageCount = chat.messages.length;
  const remoteTyping = chat.remoteTyping;
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const input = draftRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 44), 140)}px`;
  }, [draft, selectedId]);

  useEffect(() => {
    stickToBottom.current = true;
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !stickToBottom.current) return;
    const frame = requestAnimationFrame(() => {
      const messages = messagesRef.current;
      messages?.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, messageCount, remoteTyping]);

  // See support-widget.tsx for why this no longer checks needs_human: the
  // server auto-escalates out of "bot" status the instant it can't answer,
  // so this button offers proactive escalation during an active AI chat.
  const canTalkToHuman = chat.selected?.status === "bot";
  const statusText = chat.selected?.status === "assigned"
    ? `Chatting with ${chat.selected.assigned_agent_name || "Peakle support"}`
    : chat.selected ? STATUS_LABEL[chat.selected.status]
    : "";
  const lastMineMessage = [...chat.messages].reverse().find((message) => message.sender_type === "user");
  const seen = Boolean(
    chat.selected?.agent_last_read_at
      && lastMineMessage
      && new Date(chat.selected.agent_last_read_at) >= new Date(lastMineMessage.created_at)
  );

  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (file) setPendingFile(file);
  };

  const submitStart = async (event: React.SyntheticEvent, promptOverride?: string, categoryOverride?: string) => {
    event.preventDefault();
    const clean = (promptOverride ?? draft).trim();
    if (!clean && !pendingFile) return;
    stickToBottom.current = true;
    const ok = await chat.startConversation(clean, categoryOverride ?? category, pendingFile);
    if (ok) { setDraft(""); setPendingFile(null); }
  };

  const submitSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean && !pendingFile) return;
    stickToBottom.current = true;
    const ok = await chat.sendMessage(clean, pendingFile);
    if (ok) { setDraft(""); setPendingFile(null); }
  };

  const beginNewConversation = () => {
    chat.notifyTyping(false);
    chat.setSelectedId(null);
    setDraft("");
    setPendingFile(null);
  };

  const handleDelete = async (conversationId: string) => {
    const ok = await chat.deleteConversation(conversationId);
    if (ok) setConfirmDeleteId(null);
  };

  if (chat.loading) return <Empty title="Loading support" detail="Fetching your conversations with Peakle support." />;

  return (
    <div className="support-layout">
      <div className="support-list-panel">
        <button className="button button-accent" type="button" onClick={beginNewConversation}>New conversation</button>
        <div className="support-list">
        {chat.conversations.map((item) => {
          const confirming = confirmDeleteId === item.conversation_id;
          const deleting = chat.deletingId === item.conversation_id;
          return (
            <div
              key={item.conversation_id}
              className={`support-conversation-item${item.conversation_id === chat.selectedId ? " active" : ""}`}
            >
              {confirming ? (
                <div className="support-conversation-item-confirm">
                  <span>Delete this conversation?</span>
                  <div className="support-conversation-item-confirm-actions">
                    <button className="mini-button" type="button" disabled={deleting} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    <button className="mini-button danger" type="button" disabled={deleting} onClick={() => handleDelete(item.conversation_id)}>
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="support-conversation-item-select"
                    onClick={() => chat.setSelectedId(item.conversation_id)}
                  >
                    <div className="support-conversation-item-top">
                      <span className={`status ${item.status}`}>{STATUS_SHORT[item.status] || item.status}</span>
                      <span className="support-conversation-item-meta">
                        {item.unread_count > 0 ? <span className="nav-badge">{item.unread_count > 9 ? "9+" : item.unread_count}</span> : null}
                        {item.last_message_at ? <span className="support-conversation-item-time">{formatTime(item.last_message_at)}</span> : null}
                      </span>
                    </div>
                    <strong>{item.category || "Support request"}</strong>
                    <span className="support-conversation-item-preview">{item.last_body || "No messages yet"}</span>
                  </button>
                  <button
                    type="button"
                    className="support-conversation-item-delete"
                    aria-label="Delete conversation"
                    onClick={() => setConfirmDeleteId(item.conversation_id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          );
        })}
        {!chat.conversations.length ? (
          <div className="support-list-empty">
            <MessageCircle size={18} aria-hidden="true" />
            <strong>No conversations yet</strong>
            <span>Start one below and Peakle AI will jump in.</span>
          </div>
        ) : null}
        </div>
      </div>

      {chat.selectedId && chat.selected ? (
        <div className="support-thread">
          <div className="support-thread-header">
            <div className="support-widget-title">
              <span className="support-ai-mark" aria-hidden="true">
                {chat.selected.status === "bot" ? <Sparkles size={15} /> : <UserRound size={15} />}
              </span>
              <div>
                <h3>{chat.selected.status === "bot" ? "Peakle AI" : "Peakle support"}</h3>
                <p>{statusText}</p>
              </div>
            </div>
            {canTalkToHuman ? (
              <button className="button button-ghost" type="button" disabled={chat.requestingHuman} onClick={chat.talkToHuman}>
                <UserRound size={15} /> {chat.requestingHuman ? "Connecting…" : "Talk to a human"}
              </button>
            ) : null}
          </div>
          <div
            ref={messagesRef}
            className="support-thread-messages"
            aria-live="polite"
            onScroll={(event) => {
              const messages = event.currentTarget;
              stickToBottom.current = messages.scrollHeight - messages.clientHeight - messages.scrollTop < 72;
            }}
          >
            {chat.messages.map((message) => {
              const mine = message.sender_type === "user" && message.sender_id === chat.userId;
              const fromAi = message.sender_type === "ai";
              const isLastMine = mine && message.id === lastMineMessage?.id;
              return (
                <div key={message.id} className={`support-message${mine ? " mine" : ""}${fromAi ? " ai" : ""}`}>
                  {!mine ? (
                    <span className={`support-sender-label${message.sender_type === "ai" ? " ai" : ""}`}>
                      {fromAi ? <><Sparkles size={10} aria-hidden="true" /> Peakle AI</> : message.profiles?.display_name || "Peakle support"}
                    </span>
                  ) : null}
                  <div className="support-bubble">
                    {message.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed, expiring Supabase Storage URL; next/image's remote-pattern config can't allowlist per-signature URLs.
                      <img src={message.media_url} alt="Attachment" style={{ display: "block", maxWidth: 220, borderRadius: 10, marginBottom: message.body ? 6 : 0 }} />
                    ) : null}
                    {message.body}
                    <div className="support-bubble-time">{formatTime(message.created_at)}</div>
                  </div>
                  {isLastMine && seen ? <span className="table-secondary" style={{ marginTop: 3 }}>Seen</span> : null}
                </div>
              );
            })}
            {chat.remoteTyping ? (
              <div className="support-typing" aria-label="Peakle support is typing"><span /><span /><span /></div>
            ) : null}
            {chat.selected.status === "closed" && !chat.selected.csat_rating ? <CsatCard busy={chat.ratingBusy} onSubmit={chat.submitRating} /> : null}
          </div>
          {chat.selected.status === "bot" ? (
            <div className="support-suggestions">
              {SUPPORT_QUICK_REPLIES.slice(0, 3).map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="support-suggestion-card"
                  disabled={chat.sending}
                  onClick={() => { stickToBottom.current = true; void chat.sendMessage(item.prompt, null); }}
                >
                  {item.prompt}
                </button>
              ))}
            </div>
          ) : null}
          <form className="support-composer" onSubmit={submitSend} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            {pendingFile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="table-secondary">{pendingFile.name}</span>
                <button className="icon-button" type="button" onClick={() => setPendingFile(null)}><X size={14} /></button>
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={pickFile} />
              <button className="icon-button" type="button" aria-label="Attach an image" onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></button>
              <textarea
                ref={draftRef}
                value={draft}
                onChange={(event) => { setDraft(event.target.value); chat.notifyTyping(Boolean(event.target.value.trim())); }}
                onBlur={() => chat.notifyTyping(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={chat.selected.status === "bot" ? "Ask Peakle AI" : "Message Peakle support"}
                maxLength={4000}
                rows={1}
                style={{ flex: 1 }}
              />
              <button className="button button-accent" type="submit" disabled={(!draft.trim() && !pendingFile) || chat.sending}><Send size={15} /></button>
            </div>
          </form>
        </div>
      ) : (
        <div className="support-thread">
          <div className="support-thread-header">
            <div className="support-widget-title">
              <span className="support-ai-mark" aria-hidden="true"><Sparkles size={15} /></span>
              <div>
                <h3>Start a new conversation</h3>
                <p>Peakle AI answers first and can connect you with a teammate.</p>
              </div>
            </div>
          </div>
          <div style={{ padding: "18px 20px 4px" }}>
            <p className="eyebrow support-topics-label">COMMON TOPICS</p>
            <div className="support-topics">
              {SUPPORT_QUICK_REPLIES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="support-list-item"
                  disabled={chat.sending}
                  onClick={(event) => submitStart(event, item.prompt, item.category)}
                >
                  <strong>{item.label}</strong>
                </button>
              ))}
            </div>
          </div>
          <form className="support-composer" onSubmit={submitStart} style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <SelectControl
              value={category}
              onChange={setCategory}
              ariaLabel="Support topic"
              options={SUPPORT_CATEGORIES.map((item) => ({ value: item, label: item }))}
            />
            {pendingFile ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="table-secondary">{pendingFile.name}</span>
                <button className="icon-button" type="button" onClick={() => setPendingFile(null)}><X size={14} /></button>
              </div>
            ) : null}
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tell us what's going on…" maxLength={4000} style={{ minHeight: 88 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={pickFile} />
              <button className="button button-ghost" type="button" onClick={() => fileInputRef.current?.click()}><Paperclip size={15} /> Attach image</button>
              <button className="button button-accent" type="submit" disabled={(!draft.trim() && !pendingFile) || chat.sending} style={{ flex: 1 }}>
                {chat.sending ? "Starting…" : "Start conversation"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
