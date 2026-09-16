import { DEMO_USER_ID } from "./demo-mode";

// DEMO MODE — see demo-mode.ts. Backs the fully client-side Support
// conversation shown in demo mode (no Supabase calls involved).

export const DEMO_SUPPORT_CONVERSATION_ID = "demo-support-thread";

type ConversationStatus = "bot" | "open" | "assigned" | "closed";

export type DemoSupportMessage = {
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

export type DemoSupportSummary = {
  conversation_id: string;
  status: ConversationStatus;
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

export type DemoSupportDetail = {
  conversation_id: string;
  requester_id: string;
  requester_name: string;
  requester_avatar_url: string | null;
  status: ConversationStatus;
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

export type DemoSupportThread = {
  summary: DemoSupportSummary;
  detail: DemoSupportDetail;
  messages: DemoSupportMessage[];
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const initialCreatedAt = hoursAgo(20);
const initialLastAt = hoursAgo(19.95);

export const demoSupportConversationDetail: DemoSupportDetail = {
  conversation_id: DEMO_SUPPORT_CONVERSATION_ID,
  requester_id: DEMO_USER_ID,
  requester_name: "Jamie Cruz",
  requester_avatar_url: null,
  status: "bot",
  category: "Billing or payouts",
  ai_handled: true,
  needs_human: false,
  assigned_agent_id: null,
  assigned_agent_name: null,
  created_at: initialCreatedAt,
  last_message_at: initialLastAt,
  requester_last_read_at: initialLastAt,
  agent_last_read_at: null,
  csat_rating: null,
  csat_comment: null,
  csat_submitted_at: null,
};

const initialReply = "Great question! Payouts for Peakle Arena BGC are released every Monday for the prior week's completed bookings and settle to your linked bank or e-wallet within 1–3 business days. You can track your balance and full history anytime under Earnings.";

export const demoSupportConversationSummary: DemoSupportSummary = {
  conversation_id: DEMO_SUPPORT_CONVERSATION_ID,
  status: "bot",
  category: "Billing or payouts",
  ai_handled: true,
  needs_human: false,
  assigned_agent_id: null,
  assigned_agent_name: null,
  created_at: initialCreatedAt,
  last_message_at: initialLastAt,
  last_body: initialReply,
  last_sender_type: "ai",
  unread_count: 0,
};

export const demoSupportMessages: DemoSupportMessage[] = [
  { id: "demo-support-msg-1", conversation_id: DEMO_SUPPORT_CONVERSATION_ID, sender_type: "user", sender_id: DEMO_USER_ID, body: "Hi! When does my payout for this week get released?", media_path: null, created_at: initialCreatedAt },
  { id: "demo-support-msg-2", conversation_id: DEMO_SUPPORT_CONVERSATION_ID, sender_type: "ai", sender_id: null, body: initialReply, media_path: null, created_at: initialLastAt },
];

const DEMO_AI_REPLIES: Record<string, string> = {
  "Venue operations": "You can manage courts, hours, and blackout dates from Venue & Courts. Turning a court off hides it from players immediately, and blackout windows block new bookings without deleting the court.",
  "Account access": "Staff access lives under Staff Access. Search a teammate by the email on their Peakle account, then assign a role — Manager, Front Desk, Court Monitor, or Scorer — and they'll see the workspace the next time they sign in.",
  "Billing or payouts": "Payouts follow a weekly cycle: completed bookings and sessions from the prior week are released every Monday, with funds usually landing in 1–3 business days. Your balance and full history are under Earnings.",
  "Booking or payment": "Every booking, its payment status, and the method used are on the Bookings page. Refunds follow your venue's cancellation policy and post back to the original payment method automatically.",
  "Bug or feedback": "Thanks for flagging that — on your live workspace this reaches the Peakle team directly. This demo doesn't route reports anywhere, but nothing about real feedback ever gets lost.",
};
const DEMO_AI_FALLBACK = "Good question. On your live Peakle workspace, Peakle AI answers using your venue's real data, and can loop in a teammate anytime you need a human — just like the \"Talk to a human\" option here.";

export function demoAiReply(category: string | null | undefined): string {
  return (category && DEMO_AI_REPLIES[category]) || DEMO_AI_FALLBACK;
}

export function demoAgentGreeting(): string {
  return "Hi, this is Mika from Peakle Care — happy to help. What else can I do for you?";
}
