// Tappable shortcuts shown before a support conversation exists. Mirrors the
// topics the FAQ bot (supabase/functions/support-ai-reply) actually knows —
// keep these in sync so a tapped chip always gets a real answer.
export const SUPPORT_QUICK_REPLIES = [
  { label: 'Bookings', prompt: 'I have a question about a booking or payment status.' },
  { label: 'Refunds', prompt: 'I need help with a cancellation or refund.' },
  { label: 'Matches', prompt: 'I have a question about a match or box score.' },
  { label: 'Notifications', prompt: "I'm not receiving notifications." },
  { label: 'Account', prompt: 'I need help updating my account details.' },
  { label: 'Safety', prompt: 'I need to report a safety concern.' },
];
