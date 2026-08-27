"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Paperclip, Send, UserRound, X } from "lucide-react";
import { SUPPORT_QUICK_REPLIES } from "../config/support-quick-replies";
import { useSupportChat } from "../hooks/use-support-chat";

const STATUS_LABEL: Record<string, string> = {
  bot: "Peakle AI is answering",
  botNeedsHuman: "Couldn't find an answer — talk to a teammate?",
  open: "Waiting for a teammate",
  assigned: "A Peakle teammate joined",
  closed: "Conversation closed",
};

export function SupportWidget() {
  const chat = useSupportChat();
  const { loading, conversations, selectedId, setSelectedId } = chat;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSelected = useRef(false);

  useEffect(() => {
    if (autoSelected.current || loading || selectedId) return;
    const active = conversations.find((item) => item.status !== "closed");
    if (active) { setSelectedId(active.conversation_id); autoSelected.current = true; }
  }, [loading, conversations, selectedId, setSelectedId]);

  const unread = conversations.reduce((sum, item) => sum + (item.status !== "closed" ? item.unread_count : 0), 0);

  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (file) setPendingFile(file);
  };

  const submit = async (event: React.SyntheticEvent, promptOverride?: string) => {
    event.preventDefault();
    const clean = (promptOverride ?? draft).trim();
    if (!clean && !pendingFile) return;
    const ok = chat.selectedId
      ? await chat.sendMessage(clean, pendingFile)
      : await chat.startConversation(clean, null, pendingFile);
    if (ok) { setDraft(""); setPendingFile(null); }
  };

  const needsHuman = chat.selected?.status === "bot" && chat.selected.needs_human;
  const statusText = chat.selected?.status === "assigned"
    ? `Chatting with ${chat.selected.assigned_agent_name || "Peakle support"}`
    : needsHuman ? STATUS_LABEL.botNeedsHuman
    : chat.selected ? STATUS_LABEL[chat.selected.status]
    : "Ask a question or pick a topic below";

  return (
    <>
      <button className="support-widget-bubble" type="button" aria-label="Open Peakle support chat" onClick={() => setOpen((value) => !value)}>
        <MessageCircle size={22} />
        {unread > 0 ? <span className="nav-badge support-widget-badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="support-widget-panel">
          <div className="support-thread-header">
            <div>
              <h3>Peakle support</h3>
              <p>{statusText}</p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {needsHuman ? (
                <button className="button button-ghost" type="button" disabled={chat.requestingHuman} onClick={chat.talkToHuman}>
                  <UserRound size={15} /> {chat.requestingHuman ? "Connecting…" : "Talk to a human"}
                </button>
              ) : null}
              <button className="icon-button" type="button" aria-label="Close support chat" onClick={() => setOpen(false)}><X size={16} /></button>
            </div>
          </div>
          <div className="support-thread-messages">
            {!chat.selectedId ? (
              <div className="support-list" style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {SUPPORT_QUICK_REPLIES.map((item) => (
                  <button key={item.label} type="button" className="support-list-item" style={{ flex: "0 0 auto" }} onClick={(event) => submit(event, item.prompt)}>
                    <strong>{item.label}</strong>
                  </button>
                ))}
              </div>
            ) : null}
            {chat.messages.map((message) => {
              const mine = message.sender_type === "user" && message.sender_id === chat.userId;
              return (
                <div key={message.id} className={`support-message${mine ? " mine" : ""}`}>
                  {!mine ? (
                    <span className={`support-sender-label${message.sender_type === "ai" ? " ai" : ""}`}>
                      {message.sender_type === "ai" ? "Peakle AI" : message.profiles?.display_name || "Peakle support"}
                    </span>
                  ) : null}
                  <div className="support-bubble">
                    {message.media_url ? <img src={message.media_url} alt="Attachment" style={{ display: "block", maxWidth: 180, borderRadius: 10, marginBottom: message.body ? 6 : 0 }} /> : null}
                    {message.body}
                  </div>
                </div>
              );
            })}
            {chat.remoteTyping ? <p className="table-secondary">Peakle support is typing…</p> : null}
          </div>
          <form className="support-composer" onSubmit={submit} style={{ gap: 8 }}>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={pickFile} />
            <button className="icon-button" type="button" aria-label="Attach an image" onClick={() => fileInputRef.current?.click()}><Paperclip size={15} /></button>
            <textarea
              value={draft}
              onChange={(event) => { setDraft(event.target.value); chat.notifyTyping(Boolean(event.target.value.trim())); }}
              onBlur={() => chat.notifyTyping(false)}
              placeholder="Message Peakle support"
              maxLength={4000}
              style={{ flex: 1, minHeight: 40 }}
            />
            <button className="button button-accent" type="submit" disabled={(!draft.trim() && !pendingFile) || chat.sending}><Send size={15} /></button>
          </form>
        </div>
      ) : null}
    </>
  );
}
