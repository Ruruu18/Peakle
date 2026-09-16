// Canned openers an agent can drop into the reply box with one click, then
// edit before sending. Unlike the player/organizer-facing quick replies
// (which send a full question immediately), these are starting points for
// an agent's own reply — so short label + editable inserted text.
export const AGENT_QUICK_REPLIES = [
  { label: "Looking into it", text: "Thanks for reaching out — I'm looking into this now." },
  { label: "Ask for details", text: "Could you share a bit more detail (and a screenshot if you have one)?" },
  { label: "Resolved", text: "This should be resolved now — let us know if it happens again." },
  { label: "Escalating", text: "I've flagged this to the right team and will follow up here shortly." },
] as const;
