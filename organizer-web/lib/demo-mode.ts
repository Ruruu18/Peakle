import type { User } from "@supabase/supabase-js";

// DEMO MODE — backs the "View the interactive demo" entry point on the
// organizer login screen. Safe to delete along with demo-data.ts,
// demo-supabase.ts, demo-support.ts, and demo-notifications.ts, plus the
// small integration points in supabase.ts, organizer-data.ts, providers.tsx,
// login-screen.tsx, organizer-portal.tsx, use-notifications.ts, and
// use-support-chat.ts once the demo is retired.

export const DEMO_USER_ID = "demo-organizer";
const STORAGE_KEY = "peakle-organizer-demo";

let active = false;

export function isDemoModeActive() {
  return active;
}

export function enterDemoMode() {
  active = true;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private browsing or storage disabled — demo still works for this tab */
  }
}

export function exitDemoMode() {
  active = false;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function restoreDemoModeFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    active = window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    active = false;
  }
  return active;
}

export function isDemoUser(user: { id?: string | null } | null | undefined) {
  return Boolean(user && user.id === DEMO_USER_ID);
}

export function createDemoUser(): User {
  const now = new Date().toISOString();
  return {
    id: DEMO_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "demo.organizer@peakle.app",
    phone: "",
    app_metadata: { provider: "demo" },
    user_metadata: { full_name: "Jamie Cruz" },
    identities: [],
    created_at: now,
    updated_at: now,
  } as unknown as User;
}
