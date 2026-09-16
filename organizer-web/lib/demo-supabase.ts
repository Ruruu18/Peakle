import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoUser } from "./demo-mode";
import { advanceDemoScoring, assignDemoLineup, DEMO_COMPETITION_DIVISIONS } from "./demo-data";

// DEMO MODE — see demo-mode.ts. A minimal, safe stand-in for the Supabase
// client used whenever demo mode is active. Reads resolve to harmless empty
// defaults (or a couple of table-aware overrides below); writes resolve as
// if they succeeded so the real UI's own success/error handling runs
// unchanged, while a persistent banner in the shell makes clear nothing is
// actually saved. This is what lets every organizer screen — including
// dialogs and settings this feature doesn't otherwise touch — work without
// crashing against a fake, unauthenticated demo session.

type AnyResult = { data: unknown; error: null };

class DemoBuilder implements PromiseLike<AnyResult> {
  constructor(private value: unknown) {}
  select() { return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  not() { return this; }
  order() { return this; }
  limit() { return this; }
  insert() { return this; }
  update() { return this; }
  upsert() { return this; }
  delete() { return this; }
  single() {
    return new DemoBuilder(Array.isArray(this.value) ? this.value[0] ?? null : this.value ?? null);
  }
  maybeSingle() {
    return this.single();
  }
  then<TResult1 = AnyResult, TResult2 = never>(
    onfulfilled?: ((value: AnyResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.value, error: null }).then(onfulfilled, onrejected);
  }
}

// Real reads this app makes outside the main workspace/notifications/support
// loads (which are already served realistic demo data before they ever reach
// this client). Kept table-aware only where a blank result would visibly
// break a flagship screen, like the competition bracket monitor.
const TABLE_DEFAULTS: Record<string, unknown> = {
  competition_divisions: DEMO_COMPETITION_DIVISIONS,
};

function fromTable(table: string) {
  return new DemoBuilder(TABLE_DEFAULTS[table] ?? []);
}

function rpcResult(fn: string, params?: Record<string, unknown>) {
  // Gates the "continue" step of the open play wizard on court availability —
  // without this every court would read as unavailable and the dialog would
  // get stuck on step one.
  if (fn === "get_court_availability") {
    const courtIds = (params?.p_court_ids as string[] | undefined) ?? [];
    return new DemoBuilder(courtIds.map((court_id) => ({ court_id, available: true })));
  }
  // Lets a court freed up by the score simulator below get reassigned from
  // the queue instead of dead-ending on a court that looks open but isn't.
  if (fn === "assign_fair_play_match") {
    assignDemoLineup(
      params?.p_court_id as string,
      (params?.p_player_ids as string[] | undefined) ?? [],
      params?.p_scorer_player_id as string,
    );
    return new DemoBuilder(null);
  }
  const readLike = /^(get|list|fetch)_/.test(fn);
  return new DemoBuilder(readLike ? [] : null);
}

// Real screens subscribe to postgres_changes so live scores refresh without
// polling. Nothing in demo mode ever writes to a real table, so instead this
// tick loop advances the demo scores itself and then fires every subscribed
// channel's handlers, which is what makes the Live Monitor look genuinely
// live (Open Play courts and the competition bracket) during a demo.
const TICK_MS = 5_000;
let tickTimer: ReturnType<typeof setInterval> | undefined;
const liveChannels = new Set<{ handlers: Array<() => void> }>();

function ensureTicking() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    advanceDemoScoring();
    liveChannels.forEach((channel) => channel.handlers.forEach((handler) => handler()));
  }, TICK_MS);
}

function stopTickingIfIdle() {
  if (liveChannels.size > 0 || !tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = undefined;
}

function createMockChannel() {
  const record = { handlers: [] as Array<() => void> };
  const channel = {
    on(_event: string, _filter: unknown, callback: () => void) {
      record.handlers.push(callback);
      return channel;
    },
    subscribe(callback?: (status: string) => void) {
      liveChannels.add(record);
      ensureTicking();
      callback?.("SUBSCRIBED");
      return channel;
    },
    send() { return Promise.resolve("ok" as const); },
    unsubscribe() {
      liveChannels.delete(record);
      stopTickingIfIdle();
      return Promise.resolve("ok" as const);
    },
  };
  return channel;
}

function createMockBucket() {
  return {
    upload: async (path: string) => ({ data: { path }, error: null }),
    remove: async () => ({ data: null, error: null }),
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://i.pravatar.cc/240?u=${encodeURIComponent(path)}` } }),
    createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: null })), error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: null }, error: null }),
  };
}

export function createDemoSupabaseClient(): SupabaseClient {
  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: createDemoUser() }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    updateUser: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ error: null }),
    signUp: async () => ({ data: { session: null }, error: null }),
    signInWithOAuth: async () => ({ error: null }),
  };
  const client = {
    from: (table: string) => fromTable(table),
    rpc: (fn: string, params?: Record<string, unknown>) => rpcResult(fn, params),
    auth,
    channel: () => createMockChannel(),
    getChannels: () => [] as unknown[],
    removeChannel: async (channel: { unsubscribe?: () => Promise<"ok"> }) => { await channel?.unsubscribe?.(); return "ok" as const; },
    storage: { from: () => createMockBucket() },
  };
  return client as unknown as SupabaseClient;
}
