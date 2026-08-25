"use client";

import type { User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { withTimeout } from "@/lib/async";

type ColorMode = "light" | "dark";
type ThemeContextValue = { mode: ColorMode; toggle: () => void };
type AuthContextValue = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  issue: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const AuthContext = createContext<AuthContextValue | null>(null);

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ColorMode>("light");

  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = window.localStorage.getItem("peakle-organizer-theme") as ColorMode | null;
      const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      setMode(stored === "dark" || stored === "light" ? stored : preferred);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = mode; }, [mode]);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      window.localStorage.setItem("peakle-organizer-theme", next);
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ mode, toggle }}>{children}</ThemeContext.Provider>;
}

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => isSupabaseConfigured());
  const [issue, setIssue] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    const client = getSupabase();
    if (!client) return;
    let alive = true;
    void withTimeout(client.auth.getSession(), 8000, "Session restore timed out.")
      .then(({ data, error }) => {
        if (error) throw error;
        if (alive) setUser(data.session?.user ?? null);
      })
      .catch(() => {
        if (alive) {
          setUser(null);
          setIssue("We couldn’t restore the previous session. You can sign in again below.");
        }
      })
      .finally(() => { if (alive) setLoading(false); });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) {
        setUser(session?.user ?? null);
        setIssue(null);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = getSupabase();
    if (!client) throw new Error("Add the Supabase environment values before signing in.");
    setIssue(null);
    const { error } = await withTimeout(
      client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }),
      15000,
      "Sign in took too long. Check your connection and try again.",
    );
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const client = getSupabase();
    if (!client) throw new Error("Add the Supabase environment values before creating an account.");
    setIssue(null);
    const { data, error } = await withTimeout(
      client.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { display_name: name.trim(), account_type: "organizer" },
          emailRedirectTo: `${window.location.origin}/overview`,
        },
      }),
      15000,
      "Account creation took too long. Check your connection and try again.",
    );
    if (error) throw error;
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const client = getSupabase();
    if (!client) throw new Error("Add the Supabase environment values before signing in.");
    setIssue(null);
    const { error } = await withTimeout(
      client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/overview` },
      }),
      15000,
      "Google sign in took too long. Check your connection and try again.",
    );
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabase();
    if (!client) {
      setUser(null);
      return;
    }
    const { error } = await withTimeout(client.auth.signOut(), 10000, "Log out took too long. Check your connection and try again.");
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    configured,
    issue,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
  }), [configured, issue, loading, signIn, signInWithGoogle, signOut, signUp, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        {children}
        <Toaster richColors position="bottom-right" />
      </AuthProvider>
    </ThemeProvider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside Providers");
  return value;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside Providers");
  return value;
}
