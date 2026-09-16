export const STATUS_LABEL: Record<string, string> = {
  bot: "Answered by Peakle AI",
  open: "Waiting for a teammate",
  assigned: "A Peakle teammate joined",
  closed: "Conversation closed",
};

// Short forms for compact status pills (conversation list), where
// STATUS_LABEL's full sentences don't fit.
export const STATUS_SHORT: Record<string, string> = {
  bot: "AI answered",
  open: "Waiting",
  assigned: "Assigned",
  closed: "Closed",
};

export const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
