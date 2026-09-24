"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Brand } from "./login-screen";
import { useTheme } from "./providers";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

type LinkStatus = "checking" | "ready" | "invalid";

export default function ResetPasswordScreen() {
  const { mode, toggle } = useTheme();
  const router = useRouter();
  const [status, setStatus] = useState<LinkStatus>(() => (isSupabaseConfigured() ? "checking" : "invalid"));
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const client = getSupabase();
    if (!client) return;
    let settled = false;
    const markReady = () => {
      if (!settled) { settled = true; setStatus("ready"); }
    };
    // The recovery link's code is exchanged for a session as soon as the
    // browser client initializes. Depending on mount order that can happen
    // before this listener attaches, so also check for an existing session.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) markReady();
    });
    void client.auth.getSession().then(({ data: sessionData }) => {
      if (sessionData.session) markReady();
    });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; setStatus("invalid"); }
    }, 5000);
    return () => {
      data.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Use at least 8 characters for your new password.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    const client = getSupabase();
    if (!client) return;
    setBusy(true);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      await client.auth.signOut();
      toast.success("Password updated. Sign in with your new password.");
      router.replace("/login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The password could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Peakle Organizer introduction">
        <div className="login-story-grid" />
        <div className="login-story-top">
          <Brand light />
          <button className="theme-button theme-button-dark" type="button" onClick={toggle} aria-label={`Use ${mode === "dark" ? "light" : "dark"} mode`}>
            {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="login-story-copy">
          <p className="eyebrow eyebrow-optic">ACCOUNT RECOVERY</p>
          <h1>Set a new<br /><span>password.</span></h1>
          <p>Choose a strong password for your organizer account.</p>
        </div>
        <div className="story-proof" />
        <Image src="/ball.png" alt="" width={520} height={520} className="login-story-art" priority />
      </section>

      <section className="login-panel">
        <div className="mobile-login-brand"><Brand /></div>
        <div className="login-card">
          <Link className="auth-home-link" href="/login">
            <ArrowLeft size={16} /> Back to sign in
          </Link>

          {status === "invalid" ? (
            <>
              <p className="eyebrow">LINK EXPIRED</p>
              <h2>This reset link isn&rsquo;t valid</h2>
              <p className="login-intro">Password reset links expire after a while and can only be used once. Request a new one to continue.</p>
              <Link className="button button-accent login-submit" href="/forgot-password">Request a new link <ArrowRight size={17} /></Link>
            </>
          ) : status === "checking" ? (
            <>
              <p className="eyebrow">ACCOUNT RECOVERY</p>
              <h2>Checking your link…</h2>
              <p className="login-intro">One moment while we verify your reset link.</p>
            </>
          ) : (
            <>
              <p className="eyebrow">ACCOUNT RECOVERY</p>
              <h2>Choose a new password</h2>
              <p className="login-intro">Set a new password for your organizer account.</p>

              <form onSubmit={submit}>
                <label htmlFor="new-password">NEW PASSWORD</label>
                <div className="password-field">
                  <input id="new-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters" required />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
                <label htmlFor="confirm-new-password">CONFIRM PASSWORD</label>
                <input id="confirm-new-password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
                <button className="button button-accent login-submit" disabled={busy || password.length < 8 || confirmPassword.length < 8} type="submit">
                  {busy ? "Updating…" : "Update password"}<ArrowRight size={17} />
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
