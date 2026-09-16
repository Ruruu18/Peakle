// Tappable shortcuts shown before a support conversation exists. Mirrors the
// topics the built-in database responder actually knows —
// keep these in sync so a tapped chip always gets a real answer.
//
// `category` uses the same vocabulary as the full support page's dropdown
// (SUPPORT_CATEGORIES in support-section.tsx) so a conversation started from
// a quick reply is categorized the same way as one started from the form.
export const SUPPORT_QUICK_REPLIES = [
  { label: "Venues", category: "Venue operations", prompt: "I have a question about venue or court setup." },
  { label: "Staff access", category: "Account access", prompt: "I need help with staff access for my venue." },
  { label: "Payouts", category: "Billing or payouts", prompt: "I have a question about earnings or a payout." },
  { label: "Open Play", category: "Venue operations", prompt: "I have a question about publishing or managing an Open Play session." },
  { label: "Bookings", category: "Booking or payment", prompt: "I have a question about a booking or refund." },
] as const;
