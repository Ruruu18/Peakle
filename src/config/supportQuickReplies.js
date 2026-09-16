// Tappable shortcuts shown before a support conversation exists. Mirrors the
// topics the built-in database responder actually knows —
// keep these in sync so a tapped chip always gets a real answer.
//
// `category` uses the same vocabulary as the "Contact us" form's dropdown
// (SUPPORT_CATEGORIES in HelpSupportScreen.js) so a conversation started from
// a quick reply is categorized the same way as one started from the form.
export const SUPPORT_QUICK_REPLIES = [
  { label: 'Bookings', category: 'Booking or payment', prompt: 'I have a question about a booking or payment status.' },
  { label: 'Refunds', category: 'Booking or payment', prompt: 'I need help with a cancellation or refund.' },
  { label: 'Matches', category: 'Match or score', prompt: 'I have a question about a match or box score.' },
  { label: 'Notifications', category: 'Account access', prompt: "I'm not receiving notifications." },
  { label: 'Account', category: 'Account access', prompt: 'I need help updating my account details.' },
  { label: 'Safety', category: 'Safety concern', prompt: 'I need to report a safety concern.' },
];
