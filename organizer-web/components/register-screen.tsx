"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, MailCheck, Moon, ShieldCheck, Smartphone, Sun, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { Brand } from "./login-screen";
import { useAuth, useTheme } from "./providers";
import { organizerRegisterDescription, organizerTrialEnabled } from "@/lib/launch-offer";

export default function RegisterScreen() {
  const { user, loading, configured, signUp, signInWithGoogle } = useAuth();
  const { mode, toggle } = useTheme();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");

  useEffect(() => {
    if (!loading && user) router.replace("/overview");
  }, [loading, router, user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 6) {
      toast.error("Use at least 6 characters for your password.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await signUp(name, email, password);
      if (result.needsEmailConfirmation) setConfirmationEmail(email.trim().toLowerCase());
      else router.replace("/overview");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your organizer account could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google sign up could not be started.");
      setBusy(false);
    }
  };

  return (
    <main className="login-page register-page">
      <section className="login-story" aria-label="Peakle Organizer account introduction">
        <div className="login-story-grid" />
        <div className="login-story-top">
          <Brand light />
          <button className="theme-button theme-button-dark" type="button" onClick={toggle} aria-label={`Use ${mode === "dark" ? "light" : "dark"} mode`}>
            {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="login-story-copy">
          <p className="eyebrow eyebrow-optic">ONE PEAKLE ACCOUNT</p>
          <h1>Build your venue.<br /><span>Grow the game.</span></h1>
          <p>Create your organizer workspace, then use the same account across the Peakle web portal and mobile app.</p>
          <div className="story-features">
            <div><span><Users size={18} /></span><p><strong>Know your players</strong>Profiles and activity stay connected.</p></div>
            <div><span><Trophy size={18} /></span><p><strong>Run every format</strong>Open play, programs, and competitions.</p></div>
            <div><span><ShieldCheck size={18} /></span><p><strong>Secure access</strong>Venue roles keep operations protected.</p></div>
          </div>
        </div>
        <div className="story-proof" />
        <Image src="/ball.png" alt="" width={520} height={520} className="login-story-art" priority />
      </section>

      <section className="login-panel register-panel">
        <div className="mobile-login-brand"><Brand /></div>
        <div className="login-card">
          <Link className="auth-home-link" href="/">
            <ArrowLeft size={16} /> Back to home
          </Link>
          {confirmationEmail ? (
            <div className="confirmation-card" role="status">
              <span className="confirmation-icon"><MailCheck size={25} /></span>
              <p className="eyebrow">CHECK YOUR INBOX</p>
              <h2>Confirm your email</h2>
              <p className="login-intro">We sent a confirmation link to <strong>{confirmationEmail}</strong>. Open it to activate your organizer account.</p>
              <Link className="button button-accent login-submit" href="/login">Back to sign in <ArrowRight size={17} /></Link>
            </div>
          ) : (
            <>
              <p className="eyebrow">{organizerTrialEnabled ? "14-DAY FREE TRIAL" : "PILOT TESTING"}</p>
              <h2>{organizerTrialEnabled ? "Start your organizer trial" : "Create your pilot account"}</h2>
              <p className="login-intro">{organizerRegisterDescription}</p>

              <div className="identity-note"><Smartphone size={18} /><p><strong>Already use Peakle on mobile?</strong><span>Don’t register again. <Link href="/login">Sign in with the same email or Google account.</Link></span></p></div>

              {!configured ? <div className="notice warning"><strong>Supabase setup needed</strong><span>Add the public environment values to enable account registration.</span></div> : null}

              <form onSubmit={submit}>
                <label htmlFor="register-name">FULL NAME</label>
                <input id="register-name" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" minLength={2} required />
                <label htmlFor="register-email">EMAIL</label>
                <input id="register-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@venue.com" autoComplete="email" required />
                <label htmlFor="register-password">PASSWORD</label>
                <div className="password-field">
                  <input id="register-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" autoComplete="new-password" minLength={6} required />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
                </div>
                <label htmlFor="register-confirm-password">CONFIRM PASSWORD</label>
                <input id="register-confirm-password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Type your password again" autoComplete="new-password" minLength={6} required />
                <button className="button button-accent login-submit" disabled={busy || !configured} type="submit">
                  {busy ? (organizerTrialEnabled ? "Starting your trial…" : "Creating account…") : (organizerTrialEnabled ? "Start free trial" : "Create account")}<ArrowRight size={17} />
                </button>
              </form>

              <div className="or"><span />OR<span /></div>
              <button className="button button-ghost google-button" disabled={busy || !configured} type="button" onClick={google}>
                <Image src="/google.svg" alt="" width={18} height={18} className="google-icon" /> Continue with Google
              </button>

              <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
              <div className="login-trust"><Check size={14} /> {organizerTrialEnabled ? "₱0 for 14 days · 0% booking fee · No card required." : "Organizer and player accounts connect to the same sessions."}</div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
