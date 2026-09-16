"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, Eye, EyeOff, Moon, ShieldCheck, Sun } from "lucide-react";
import { toast } from "sonner";
import { useAuth, useTheme } from "./providers";
import { getSupabase } from "@/lib/supabase";

export default function LoginScreen() {
  const { configured, issue, signIn, signInWithGoogle } = useAuth();
  const { mode, toggle } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      await signIn(email, password);

      // Check admin status immediately after sign in
      const client = getSupabase();
      if (client) {
        const { data: isAdmin } = await client.rpc("is_platform_admin");
        if (!isAdmin) {
          await client.auth.signOut();
          toast.error("Admin access required. Your account does not have platform admin privileges.");
          return;
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google sign in could not be started.");
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Peakle Admin introduction">
        <div className="login-story-grid" />
        <div className="login-story-top">
          <Brand light />
          <button
            className="theme-button theme-button-dark"
            type="button"
            onClick={toggle}
            aria-label={`Use ${mode === "dark" ? "light" : "dark"} mode`}
          >
            {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="login-story-copy">
          <p className="eyebrow eyebrow-optic">PLATFORM ADMINISTRATION</p>
          <h1>Command<br /><span>the platform.</span></h1>
          <p>User management, venue oversight, entitlements, and access control — full platform visibility.</p>
          <div className="story-features">
            <div>
              <span><ShieldCheck size={18} /></span>
              <p><strong>Access control</strong>Manage platform admins and organizer entitlements.</p>
            </div>
            <div>
              <span><ShieldCheck size={18} /></span>
              <p><strong>Venue oversight</strong>Approve, reject, or suspend venue applications.</p>
            </div>
            <div>
              <span><ShieldCheck size={18} /></span>
              <p><strong>User safety</strong>Monitor users, review flags, and maintain trust.</p>
            </div>
          </div>
        </div>
        <div className="story-proof">
          <span className="live-dot" /> RESTRICTED PLATFORM ACCESS
        </div>
      </section>

      <section className="login-panel">
        <div className="mobile-login-brand"><Brand /></div>
        <div className="login-card">
          <p className="eyebrow">PLATFORM ADMIN ACCESS</p>
          <h2>Admin sign in</h2>
          <p className="login-intro">Restricted to verified Peakle platform administrators.</p>

          {!configured ? (
            <div className="notice warning">
              <strong>Supabase setup needed</strong>
              <span>Add the public environment values to enable account sign-in.</span>
            </div>
          ) : null}
          {issue ? (
            <div className="notice warning">
              <strong>Session needs attention</strong>
              <span>{issue}</span>
            </div>
          ) : null}

          <form onSubmit={submit}>
            <label htmlFor="email">EMAIL</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@peakle.com"
              autoComplete="email"
              required
            />
            <label htmlFor="password">PASSWORD</label>
            <div className="password-field">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button
              className="button button-accent login-submit"
              disabled={busy || !configured}
              type="submit"
            >
              {busy ? "Authenticating…" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>

          <div className="or"><span />OR<span /></div>
          <button className="button button-ghost google-button" disabled={busy || !configured} type="button" onClick={google}>
            <Image src="/google.svg" alt="" width={18} height={18} className="google-icon" /> Continue with Google
          </button>

          <div className="login-trust">
            <ShieldCheck size={14} /> Access is gated by verified platform admin status.
          </div>
        </div>
      </section>
    </main>
  );
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`} aria-label="Peakle Admin">
      <Image src="/ball_green.png" alt="" width={32} height={32} className="brand-logo" priority />
      <span className="brand-word">Peakle</span>
      <span className="brand-edition">ADMIN</span>
    </div>
  );
}
