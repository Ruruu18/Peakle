import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemoModeActive } from "./demo-mode";
import { createDemoSupabaseClient } from "./demo-supabase";

let browserClient: SupabaseClient | null = null;
let demoClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getSupabase(): SupabaseClient | null {
  // DEMO MODE — see demo-mode.ts. Every caller of getSupabase()/requireSupabase()
  // transparently gets a safe mock client while the interactive demo is active.
  if (isDemoModeActive()) {
    if (!demoClient) demoClient = createDemoSupabaseClient();
    return demoClient;
  }
  if (!isSupabaseConfigured()) return null;
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return browserClient;
}

export function requireSupabase() {
  const client = getSupabase();
  if (!client) throw new Error("Supabase is not configured for the organizer portal.");
  return client;
}
