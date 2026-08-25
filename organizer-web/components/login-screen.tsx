"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Eye, EyeOff, Moon, ShieldCheck, Sun, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth, useTheme } from "./providers";

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
      <section className="login-story" aria-label="Peakle Organizer introduction">
        <div className="login-story-grid" />
        <div className="login-story-top">
          <Brand light />
          <button className="theme-button theme-button-dark" type="button" onClick={toggle} aria-label={`Use ${mode === "dark" ? "light" : "dark"} mode`}>
            {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="login-story-copy">
          <p className="eyebrow eyebrow-optic">ORGANIZER WORKSPACE</p>
          <h1>Run every court.<br /><span>Miss nothing.</span></h1>
          <p>Live sessions, player flow, venue operations, and growth—one court-ready command center.</p>
          <div className="story-features">
            <div><span><Users size={18} /></span><p><strong>Player flow</strong>Check-in, queue, and court rotation.</p></div>
            <div><span><Trophy size={18} /></span><p><strong>Competition</strong>Programs, brackets, and results.</p></div>
            <div><span><ShieldCheck size={18} /></span><p><strong>Venue control</strong>Staff access and secure operations.</p></div>
          </div>
        </div>
        <div className="story-proof" />
        <Image src="/ball.png" alt="" width={520} height={520} className="login-story-art" priority />
      </section>

      <section className="login-panel">
        <div className="mobile-login-brand"><Brand /></div>
        <div className="login-card">

          <p className="eyebrow">WELCOME BACK</p>
          <h2>Organizer sign in</h2>
          <p className="login-intro">Use the same Peakle account you use on mobile.</p>

          {!configured ? <div className="notice warning"><strong>Supabase setup needed</strong><span>Add the public environment values to enable account sign-in.</span></div> : null}
          {issue ? <div className="notice warning"><strong>Session needs attention</strong><span>{issue}</span></div> : null}

          <form onSubmit={submit}>
            <label htmlFor="email">EMAIL</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@venue.com" autoComplete="email" required />
            <label htmlFor="password">PASSWORD</label>
            <div className="password-field">
              <input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" autoComplete="current-password" required />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
            <button className="button button-accent login-submit" disabled={busy || !configured} type="submit">
              {busy ? "Opening workspace…" : "Sign in"}<ArrowRight size={17} />
            </button>
          </form>

          <div className="or"><span />OR<span /></div>
          <button className="button button-ghost google-button" disabled={busy || !configured} type="button" onClick={google}>
            <Image src="/google.svg" alt="" width={18} height={18} className="google-icon" /> Continue with Google
          </button>

          <p className="auth-switch">New to Peakle Organizer? <Link href="/register">Create an organizer account</Link></p>

          <div className="login-trust"><Check size={14} /> Protected by the same Peakle permissions and venue roles.</div>
        </div>
      </section>
    </main>
  );
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`} aria-label="Peakle Organizer">
      <Image src="/ball_green.png" alt="" width={32} height={32} className="brand-logo" priority />
      <span className="brand-word">Peakle</span>
      <span className="brand-edition">ORG</span>
    </div>
  );
}
