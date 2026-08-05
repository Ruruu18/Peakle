export const portalSections = ["overview", "open-play", "monitor", "players", "venues", "programs", "competitions", "memberships", "analytics", "staff", "settings"] as const;
export type PortalSection = (typeof portalSections)[number];
