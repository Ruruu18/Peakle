"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, MailCheck, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Brand } from "./login-screen";
import { useAuth, useTheme } from "./providers";

export default function ForgotPasswordScreen() {
  const { configured, sendPasswordReset } = useAuth();
  const { mode, toggle } = useTheme();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setSentTo(email.trim().toLowerCase());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The reset link could not be sent.");
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
          <h1>Locked out?<br /><span>Let&rsquo;s fix that.</span></h1>
          <p>We&rsquo;ll email a secure link to reset your organizer password.</p>
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
          {sentTo ? (
            <div className="confirmation-card" role="status">
              <span className="confirmation-icon"><MailCheck size={25} /></span>
              <p className="eyebrow">CHECK YOUR INBOX</p>
              <h2>Reset link sent</h2>
              <p className="login-intro">If <strong>{sentTo}</strong> has a Peakle Organizer account, we sent a link to reset the password. Open it on this device to continue.</p>
              <Link className="button button-accent login-submit" href="/login">Back to sign in <ArrowRight size={17} /></Link>
            </div>
          ) : (
            <>
              <p className="eyebrow">FORGOT PASSWORD</p>
              <h2>Reset your password</h2>
              <p className="login-intro">Enter the email on your organizer account and we&rsquo;ll send a link to reset your password.</p>

              {!configured ? <div className="notice warning"><strong>Supabase setup needed</strong><span>Add the public environment values to enable password recovery.</span></div> : null}

              <form onSubmit={submit}>
                <label htmlFor="reset-email">EMAIL</label>
                <input id="reset-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@venue.com" autoComplete="email" required />
                <button className="button button-accent login-submit" disabled={busy || !configured} type="submit">
                  {busy ? "Sending…" : "Send reset link"}<ArrowRight size={17} />
                </button>
              </form>

              <p className="auth-switch">Remembered it? <Link href="/login">Sign in</Link></p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
