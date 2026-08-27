// Tappable shortcuts shown before a support conversation exists. Mirrors the
// topics the FAQ bot (supabase/functions/support-ai-reply) actually knows —
// keep these in sync so a tapped chip always gets a real answer.
export const SUPPORT_QUICK_REPLIES = [
  { label: "Venues", prompt: "I have a question about venue or court setup." },
  { label: "Staff access", prompt: "I need help with staff access for my venue." },
  { label: "Payouts", prompt: "I have a question about earnings or a payout." },
  { label: "Open Play", prompt: "I have a question about publishing or managing an Open Play session." },
  { label: "Bookings", prompt: "I have a question about a booking or refund." },
] as const;
