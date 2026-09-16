"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Paperclip, Plus, Send, Sparkles, UserRound, X } from "lucide-react";
import { SUPPORT_QUICK_REPLIES } from "../config/support-quick-replies";
import { useSupportChat } from "../hooks/use-support-chat";
import { STATUS_LABEL, formatTime } from "../lib/support-chat-ui";

function Typewriter({ text, messageId, onDone }: { text: string; messageId: string; onDone: (id: string) => void }) {
  const [displayed, setDisplayed] = useState("");
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setDisplayed(text.slice(0, i + 3));
      i += 3;
      if (containerRef.current) {
        const scroller = containerRef.current.closest(".support-thread-messages");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      }
      if (i >= text.length) {
        clearInterval(interval);
        onDone(messageId);
      }
    }, 15);
    return () => clearInterval(interval);
  }, [text, messageId, onDone]);

  return <span ref={containerRef}>{displayed}</span>;
}

export function SupportWidget() {
  const chat = useSupportChat();
  const { loading, conversations, selectedId, setSelectedId, notifyTyping } = chat;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const autoSelected = useRef(false);
  const [typedMessageIds, setTypedMessageIds] = useState<Set<string>>(() => new Set());
  const markTyped = useCallback((id: string) => {
    setTypedMessageIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const stickToBottom = useRef(true);
  const lastSelectedId = useRef<string | null>(null);

  useEffect(() => {
    if (autoSelected.current || loading || selectedId) return;
    const active = conversations.find((item) => item.status !== "closed");
    if (active) { setSelectedId(active.conversation_id); autoSelected.current = true; }
  }, [loading, conversations, selectedId, setSelectedId]);

  useEffect(() => {
    if (!open) return;
    if (lastSelectedId.current !== chat.selectedId) {
      lastSelectedId.current = chat.selectedId;
      stickToBottom.current = true;
    }
    if (!stickToBottom.current) return;
    const frame = requestAnimationFrame(() => {
      const messages = messagesRef.current;
      messages?.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, chat.messages.length, chat.remoteTyping, chat.selectedId]);

  useEffect(() => {
    const input = draftRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 40), 120)}px`;
  }, [draft]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      notifyTyping(false);
      requestAnimationFrame(() => bubbleRef.current?.focus());
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, notifyTyping]);

  const unread = conversations.reduce((sum, item) => sum + (item.status !== "closed" ? item.unread_count : 0), 0);

  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (file) setPendingFile(file);
  };

  const submit = async (event: React.SyntheticEvent, promptOverride?: string, categoryOverride?: string) => {
    event.preventDefault();
    const clean = (promptOverride ?? draft).trim();
    if (!clean && !pendingFile) return;
    stickToBottom.current = true;
    const ok = chat.selectedId
      ? await chat.sendMessage(clean, pendingFile)
      : await chat.startConversation(clean, categoryOverride ?? null, pendingFile);
    if (ok) { setDraft(""); setPendingFile(null); }
  };

  const beginNewConversation = () => {
    autoSelected.current = true;
    notifyTyping(false);
    setSelectedId(null);
    setDraft("");
    setPendingFile(null);
  };

  const closeWidget = () => {
    notifyTyping(false);
    setOpen(false);
    requestAnimationFrame(() => bubbleRef.current?.focus());
  };

  // Escalation to a human now also happens automatically server-side once the
  // AI can't answer (see 202608280002_builtin_support_responder.sql), which
  // immediately flips status away from "bot" — so this button is for
  // proactively asking for a person while still mid-conversation with the AI,
  // not for a "couldn't answer" state the client would ever actually observe.
  const canTalkToHuman = chat.selected?.status === "bot";
  const statusText = chat.selected?.status === "assigned"
    ? `Chatting with ${chat.selected.assigned_agent_name || "Peakle support"}`
    : chat.selected ? STATUS_LABEL[chat.selected.status]
    : "Ask a question or pick a topic below";
  const isAiConversation = !chat.selected || chat.selected.status === "bot";

  return (
    <>
      <button
        ref={bubbleRef}
        className={`support-widget-bubble${open ? " is-open" : ""}`}
        type="button"
        aria-label={open ? "Close Peakle support chat" : "Open Peakle support chat"}
        aria-expanded={open}
        aria-controls="peakle-support-widget"
        onClick={() => {
          if (open) closeWidget();
          else { stickToBottom.current = true; setOpen(true); }
        }}
      >
        {open ? <X size={21} /> : <MessageCircle size={22} />}
        {unread > 0 ? <span className="nav-badge support-widget-badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      <div
        id="peakle-support-widget"
        className={`support-widget-panel${open ? " is-open" : ""}`}
        aria-hidden={!open}
        inert={!open}
      >
          <div className="support-thread-header">
            <div className="support-widget-title">
              <span className="support-ai-mark" aria-hidden="true"><Sparkles size={15} /></span>
              <div>
                <h3>{isAiConversation ? "Peakle AI" : "Peakle support"}</h3>
                <p>{statusText}</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {chat.selectedId ? (
                <button className="icon-button" type="button" aria-label="Start a new conversation" title="New conversation" onClick={beginNewConversation}>
                  <Plus size={16} />
                </button>
              ) : null}
              {canTalkToHuman ? (
                <button className="button button-ghost" type="button" disabled={chat.requestingHuman} onClick={chat.talkToHuman}>
                  <UserRound size={15} /> {chat.requestingHuman ? "Connecting…" : "Talk to a human"}
                </button>
              ) : null}
              <button className="icon-button" type="button" aria-label="Close support chat" onClick={closeWidget}><X size={16} /></button>
            </div>
          </div>
          <div
            ref={messagesRef}
            className="support-thread-messages"
            aria-live="polite"
            onScroll={(event) => {
              const messages = event.currentTarget;
              stickToBottom.current = messages.scrollHeight - messages.clientHeight - messages.scrollTop < 64;
            }}
          >
            {!chat.selectedId ? (
              <>
                <div className="support-ai-welcome">
                  <span className="support-ai-mark" aria-hidden="true"><Sparkles size={15} /></span>
                  <div>
                    <strong>Hi, I’m Peakle AI.</strong>
                    <p>Ask me about Peakle, or choose a topic to get a quick answer.</p>
                  </div>
                </div>
                <div className="support-list">
                  {SUPPORT_QUICK_REPLIES.map((item) => (
                    <button key={item.label} type="button" className="support-list-item" onClick={(event) => submit(event, item.prompt, item.category)}>
                      <strong>{item.label}</strong>
                    </button>
                  ))}
                </div>
              </>
            ) : chat.messages.map((message) => {
              const mine = message.sender_type === "user" && message.sender_id === chat.userId;
              const fromAi = message.sender_type === "ai";
              const isRecent = new Date().getTime() - new Date(message.created_at).getTime() < 30000;
              const shouldType = fromAi && isRecent && !typedMessageIds.has(message.id);

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
                      <img src={message.media_url} alt="Attachment" style={{ display: "block", maxWidth: 180, borderRadius: 10, marginBottom: message.body ? 6 : 0 }} />
                    ) : null}
                    {shouldType ? (
                      <Typewriter text={message.body} messageId={message.id} onDone={markTyped} />
                    ) : (
                      message.body
                    )}
                    <div className="support-bubble-time">{formatTime(message.created_at)}</div>
                  </div>
                </div>
              );
            })}
            {chat.remoteTyping ? (
              <div className="support-typing" aria-label="Peakle support is typing">
                <span /><span /><span />
              </div>
            ) : null}
          </div>
          {chat.selectedId && chat.selected?.status === "bot" ? (
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
          <form className="support-composer" onSubmit={submit}>
            {pendingFile ? (
              <div className="support-attachment-pill">
                <Paperclip size={13} aria-hidden="true" />
                <span>{pendingFile.name}</span>
                <button type="button" aria-label="Remove attachment" onClick={() => setPendingFile(null)}><X size={13} /></button>
              </div>
            ) : null}
            <div className="support-composer-row">
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={pickFile} />
            <button className="icon-button" type="button" aria-label="Attach an image" onClick={() => fileInputRef.current?.click()}><Paperclip size={15} /></button>
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); notifyTyping(Boolean(event.target.value.trim())); }}
              onBlur={() => notifyTyping(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={isAiConversation ? "Ask Peakle AI" : "Message Peakle support"}
              maxLength={4000}
              rows={1}
            />
            <button className="button button-accent" type="submit" aria-label="Send message" disabled={(!draft.trim() && !pendingFile) || chat.sending}><Send size={15} /></button>
            </div>
          </form>
        </div>
    </>
  );
}
