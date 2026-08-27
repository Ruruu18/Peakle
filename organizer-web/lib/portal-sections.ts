export const portalSections = ["overview", "open-play", "bookings", "monitor", "players", "venues", "programs", "competitions", "memberships", "analytics", "earnings", "staff", "support", "settings"] as const;
export type PortalSection = (typeof portalSections)[number];
