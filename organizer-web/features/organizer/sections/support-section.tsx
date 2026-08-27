"use client";

import { useRef, useState } from "react";
import { LifeBuoy, Paperclip, Send, Star, UserRound, X } from "lucide-react";
import { Empty, SelectControl } from "../components/portal-ui";
import { SUPPORT_QUICK_REPLIES } from "../config/support-quick-replies";
import { useSupportChat } from "../hooks/use-support-chat";

const SUPPORT_CATEGORIES = ["Booking or payment", "Account access", "Venue operations", "Billing or payouts", "Bug or feedback"];

const STATUS_LABEL: Record<string, string> = {
  bot: "Peakle AI is answering",
  botNeedsHuman: "Couldn't find an answer — talk to a teammate?",
  open: "Waiting for a teammate",
  assigned: "A Peakle teammate joined",
  closed: "Conversation closed",
};

const formatTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const needsHuman = chat.selected?.status === "bot" && chat.selected.needs_human;
  const statusText = chat.selected?.status === "assigned"
    ? `Chatting with ${chat.selected.assigned_agent_name || "Peakle support"}`
    : needsHuman ? STATUS_LABEL.botNeedsHuman
    : chat.selected ? STATUS_LABEL[chat.selected.status]
    : "";
  const seen = chat.selected?.agent_last_read_at
    && [...chat.messages].reverse().find((message) => message.sender_type === "user")?.created_at
    && new Date(chat.selected.agent_last_read_at) >= new Date([...chat.messages].reverse().find((message) => message.sender_type === "user")!.created_at);

  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (file) setPendingFile(file);
  };

  const submitStart = async (event: React.SyntheticEvent, promptOverride?: string, categoryOverride?: string) => {
    event.preventDefault();
    const clean = (promptOverride ?? draft).trim();
    if (!clean && !pendingFile) return;
    const ok = await chat.startConversation(clean, categoryOverride ?? category, pendingFile);
    if (ok) { setDraft(""); setPendingFile(null); }
  };

  const submitSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean && !pendingFile) return;
    const ok = await chat.sendMessage(clean, pendingFile);
    if (ok) { setDraft(""); setPendingFile(null); }
  };

  if (chat.loading) return <Empty title="Loading support" detail="Fetching your conversations with Peakle support." />;

  return (
    <div className="support-layout">
      <div className="support-list">
        <button className="button button-accent" type="button" onClick={() => chat.setSelectedId(null)}>New conversation</button>
        {chat.conversations.map((item) => (
          <button
            key={item.conversation_id}
            type="button"
            className={`support-list-item${item.conversation_id === chat.selectedId ? " active" : ""}`}
            onClick={() => chat.setSelectedId(item.conversation_id)}
          >
            <strong>{STATUS_LABEL[item.status] || item.status}</strong>
            <span>{item.last_body || "No messages yet"}</span>
          </button>
        ))}
        {!chat.conversations.length ? <p className="support-empty-thread">No conversations yet.</p> : null}
      </div>

      {chat.selectedId && chat.selected ? (
        <div className="support-thread">
          <div className="support-thread-header">
            <div>
              <h3>Peakle support</h3>
              <p>{statusText}</p>
            </div>
            {needsHuman ? (
              <button className="button button-ghost" type="button" disabled={chat.requestingHuman} onClick={chat.talkToHuman}>
                <UserRound size={15} /> {chat.requestingHuman ? "Connecting…" : "Talk to a human"}
              </button>
            ) : (
              <LifeBuoy size={18} color="var(--teal)" />
            )}
          </div>
          <div className="support-thread-messages">
            {chat.messages.map((message) => {
              const mine = message.sender_type === "user" && message.sender_id === chat.userId;
              const isLastMine = mine && message.id === [...chat.messages].reverse().find((item) => item.sender_type === "user")?.id;
              return (
                <div key={message.id} className={`support-message${mine ? " mine" : ""}`}>
                  {!mine ? (
                    <span className={`support-sender-label${message.sender_type === "ai" ? " ai" : ""}`}>
                      {message.sender_type === "ai" ? "Peakle AI" : message.profiles?.display_name || "Peakle support"}
                    </span>
                  ) : null}
                  <div className="support-bubble">
                    {message.media_url ? <img src={message.media_url} alt="Attachment" style={{ display: "block", maxWidth: 220, borderRadius: 10, marginBottom: message.body ? 6 : 0 }} /> : null}
                    {message.body}
                    <div className="support-bubble-time">{formatTime(message.created_at)}</div>
                  </div>
                  {isLastMine && seen ? <span className="table-secondary" style={{ marginTop: 3 }}>Seen</span> : null}
                </div>
              );
            })}
            {chat.remoteTyping ? <p className="table-secondary">Peakle support is typing…</p> : null}
            {chat.selected.status === "closed" && !chat.selected.csat_rating ? <CsatCard busy={chat.ratingBusy} onSubmit={chat.submitRating} /> : null}
          </div>
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
                value={draft}
                onChange={(event) => { setDraft(event.target.value); chat.notifyTyping(Boolean(event.target.value.trim())); }}
                onBlur={() => chat.notifyTyping(false)}
                placeholder="Message Peakle support"
                maxLength={4000}
                style={{ flex: 1 }}
              />
              <button className="button button-accent" type="submit" disabled={(!draft.trim() && !pendingFile) || chat.sending}><Send size={15} /></button>
            </div>
          </form>
        </div>
      ) : (
        <div className="support-thread">
          <div className="support-thread-header">
            <div>
              <h3>Start a new conversation</h3>
              <p>Peakle AI answers first and can connect you with a teammate.</p>
            </div>
            <UserRound size={18} color="var(--teal)" />
          </div>
          <div style={{ padding: "0 18px" }}>
            <div className="support-list" style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {SUPPORT_QUICK_REPLIES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="support-list-item"
                  style={{ flex: "0 0 auto" }}
                  disabled={chat.sending}
                  onClick={(event) => submitStart(event, item.prompt, item.label)}
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
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tell us what's going on…" maxLength={4000} style={{ minHeight: 120 }} />
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
