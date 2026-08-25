"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Bell, Camera, ExternalLink, Laptop, LogOut, Moon, Settings as SettingsIcon, ShieldCheck, Sun, Trash2, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth, useTheme } from "@/components/providers";
import { requireSupabase } from "@/lib/supabase";
import { deleteProfilePhoto, uploadProfilePhoto, validateProfilePhoto } from "@/lib/profile-photo";
import type { OrganizerData } from "@/lib/types";
import { ProfileAvatar, SettingRow, titleCase } from "../components/portal-ui";

type SettingsTab = "overview" | "profile" | "notifications" | "security" | "player-app";

const defaultNotificationPreferences: Record<string, boolean> = {
  organizer: true,
  reminders: true,
  messages: true,
};

const NAV_ITEMS: { key: SettingsTab; label: string; icon: LucideIcon; href: string }[] = [
  { key: "overview", label: "Overview", icon: SettingsIcon, href: "/settings" },
  { key: "profile", label: "Profile", icon: UserCheck, href: "/settings/profile" },
  { key: "notifications", label: "Notifications", icon: Bell, href: "/settings/notifications" },
  { key: "security", label: "Security", icon: ShieldCheck, href: "/settings/security" },
  { key: "player-app", label: "Player app", icon: ExternalLink, href: "/settings/player-app" },
];

const PANEL_COPY: Record<SettingsTab, { eyebrow: string; title: string; detail: string }> = {
  overview: { eyebrow: "PREFERENCES", title: "Account and workspace", detail: "A quick summary of your identity, appearance, and account tools." },
  profile: { eyebrow: "PROFILE", title: "Shared Peakle identity", detail: "Changes here are synchronized with your player profile." },
  notifications: { eyebrow: "NOTIFICATIONS", title: "Organizer alerts", detail: "Choose which updates should reach your Peakle account." },
  security: { eyebrow: "SECURITY", title: "Account security", detail: "Review the identity and session currently used by this organizer workspace." },
  "player-app": { eyebrow: "MOBILE APP", title: "Player mobile app", detail: "Continue in the player experience using the same Peakle account." },
};

export function SettingsSection({ data, subview, refresh }: { data: OrganizerData; subview?: string; refresh: () => Promise<void> }) {
  const { mode, toggle } = useTheme();
  const { user } = useAuth();
  const active: SettingsTab = subview === "profile" || subview === "notifications" || subview === "security" || subview === "player-app" ? subview : "overview";
  const panelCopy = PANEL_COPY[active];

  return (
    <div className="settings-layout">
      <aside className="card settings-profile-card">
        <div className="settings-profile-main">
          <ProfileAvatar name={data.profile.name} photo={data.profile.avatar} />
          <div>
            <p className="eyebrow">PEAKLE ACCOUNT</p>
            <h2>{data.profile.name}</h2>
            <p>{data.profile.email || "No email available"}</p>
          </div>
        </div>
        <div className="settings-profile-meta">
          <span>HOME AREA</span>
          <strong>{data.profile.location || "Not set"}</strong>
        </div>
        <div className="plan-badge">
          <strong>{data.isAdmin ? "Platform Admin" : data.venues.length ? `Venue ${titleCase(data.venues[0].role)}` : "No venue access"}</strong>
          <small>{data.venues.length ? `${data.venues.length} venue${data.venues.length === 1 ? "" : "s"} managed` : "Add a venue to get started"}</small>
        </div>
        <nav className="settings-nav-list" aria-label="Settings sections">
          {NAV_ITEMS.map((item) => (
            <Link key={item.key} href={item.href} className={`settings-nav-link ${active === item.key ? "active" : ""}`} aria-current={active === item.key ? "page" : undefined}>
              <item.icon size={16} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <section className="card settings-panel" aria-labelledby="settings-panel-title">
        <div className="settings-panel-head">
          <div>
            <p className="eyebrow">{panelCopy.eyebrow}</p>
            <h2 id="settings-panel-title">{panelCopy.title}</h2>
            <p>{panelCopy.detail}</p>
          </div>
        </div>
        <div className="settings-panel-body">
          {active === "overview" ? <OverviewSettings mode={mode} toggle={toggle} /> : null}
          {active === "profile" ? <ProfileSettings data={data} refresh={refresh} /> : null}
          {active === "notifications" ? <NotificationSettings userId={data.profile.id} /> : null}
          {active === "security" ? <SecuritySettings email={data.profile.email || user?.email} provider={user?.app_metadata?.provider} /> : null}
          {active === "player-app" ? <PlayerAppPanel /> : null}
        </div>
      </section>
    </div>
  );
}

function OverviewSettings({ mode, toggle }: { mode: "light" | "dark"; toggle: () => void }) {
  return (
    <div className="settings-quick-list">
      <SettingRow icon={mode === "dark" ? Moon : Sun} title="Appearance" detail={`${titleCase(mode)} mode is active on this browser`} action="Toggle" onAction={toggle} />
      <SettingRow icon={UserCheck} title="Shared Peakle identity" detail="Update the name, photo, and home area used across Peakle" action="Edit" href="/settings/profile" />
      <SettingRow icon={Bell} title="Organizer alerts" detail="Choose the venue and account updates you receive" action="Manage" href="/settings/notifications" />
      <SettingRow icon={ShieldCheck} title="Account security" detail="Password, sessions, and sign-in method" action="Review" href="/settings/security" />
      <SettingRow icon={ExternalLink} title="Player mobile app" detail="Return to the Peakle player experience" action="Open" href="/settings/player-app" />
    </div>
  );
}

function PlayerAppPanel() {
  return (
    <>
      <div className="settings-callout">
        <ExternalLink size={19} />
        <div><strong>Your identity stays in sync</strong><p>Profile changes made here also appear in the Peakle player app.</p></div>
      </div>
      <a className="button button-accent inline-action" href="peakle://">Open Peakle app <ExternalLink size={15} /></a>
    </>
  );
}

function SecuritySettings({ email, provider }: { email?: string | null; provider?: unknown }) {
  const signInMethod = typeof provider === "string" && provider ? titleCase(provider) : "Email";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [signingOutOthers, setSigningOutOthers] = useState(false);

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Use at least 8 characters for your new password.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      const { error } = await requireSupabase().auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirmPassword("");
      toast.success("Password updated.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Password update failed.");
    } finally {
      setPasswordBusy(false);
    }
  };

  const signOutOthers = async () => {
    setSigningOutOthers(true);
    try {
      const { error } = await requireSupabase().auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Signed out on every other device.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not sign out other sessions.");
    } finally {
      setSigningOutOthers(false);
    }
  };

  return (
    <>
      <div className="settings-security-status">
        <span><ShieldCheck size={20} /></span>
        <div><strong>Your session is active</strong><p>Peakle protects this workspace with your account and venue permissions.</p></div>
      </div>
      <div className="detail-rows settings-detail-rows">
        <div className="detail-row"><span className="detail-label">Signed-in email</span><strong className="detail-value">{email || "Not available"}</strong></div>
        <div className="detail-row"><span className="detail-label">Sign-in method</span><strong className="detail-value">{signInMethod}</strong></div>
        <div className="detail-row"><span className="detail-label">Current session</span><span className="settings-session-active"><span /> Active on this browser</span></div>
      </div>

      <div className="settings-panel-divider" />
      <p className="settings-subhead">PASSWORD</p>
      <form className="management-form settings-form" onSubmit={changePassword}>
        <div className="form-field">
          <label htmlFor="new-password">NEW PASSWORD</label>
          <input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
        </div>
        <div className="form-field">
          <label htmlFor="confirm-password">CONFIRM PASSWORD</label>
          <input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" />
        </div>
        <button className="button button-accent" type="submit" disabled={passwordBusy || password.length < 8 || confirmPassword.length < 8}>{passwordBusy ? "Updating…" : "Update password"}</button>
      </form>

      <div className="settings-panel-divider" />
      <p className="settings-subhead">SESSIONS &amp; DEVICES</p>
      <div className="settings-callout">
        <Laptop size={19} />
        <div><strong>Signed in on this browser</strong><p>Use Log out at the bottom of the organizer sidebar to end just this session. On mobile, open More.</p></div>
      </div>
      <button className="button button-ghost settings-signout-others" type="button" onClick={() => void signOutOthers()} disabled={signingOutOthers}>
        <LogOut size={15} /> {signingOutOthers ? "Signing out…" : "Sign out of all other devices"}
      </button>
    </>
  );
}

function ProfileSettings({ data, refresh }: { data: OrganizerData; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(data.profile.name);
  const [location, setLocation] = useState(data.profile.location || "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = name.trim();
    if (displayName.length < 2) {
      toast.error("Display name must contain at least two characters.");
      return;
    }
    setBusy(true);
    try {
      const nextAvatar = photo ? await uploadProfilePhoto(data.profile.id, photo) : removePhoto ? null : data.profile.avatar;
      const { error } = await requireSupabase().from("profiles").update({ display_name: displayName, home_area: location.trim() || null, avatar_url: nextAvatar }).eq("id", data.profile.id);
      if (error) throw error;
      if ((photo || removePhoto) && data.profile.avatar && data.profile.avatar !== nextAvatar) void deleteProfilePhoto(data.profile.avatar).catch(() => undefined);
      await refresh();
      setPhoto(null);
      setPreview(null);
      setRemovePhoto(false);
      toast.success("Profile updated across Peakle.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Profile update failed.");
    } finally {
      setBusy(false);
    }
  };

  const shownPhoto = removePhoto ? null : preview || data.profile.avatar;
  return (
    <form className="management-form settings-form" onSubmit={submit}>
      <div className="profile-photo-field">
        <ProfileAvatar name={name} photo={shownPhoto} />
        <div>
          <label className="mini-button inline-action" htmlFor="profile-photo"><Camera size={14} />{shownPhoto ? "Change photo" : "Add photo"}</label>
          <input className="file-input" id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0] || null; try { if (file) validateProfilePhoto(file); setPhoto(file); setPreview(file ? URL.createObjectURL(file) : null); setRemovePhoto(false); } catch (reason) { event.currentTarget.value = ""; toast.error(reason instanceof Error ? reason.message : "Invalid profile photo."); } }} />
          {shownPhoto ? <button className="mini-button profile-photo-remove" type="button" onClick={() => { setPhoto(null); setPreview(null); setRemovePhoto(true); }}><Trash2 size={14} />Remove</button> : null}
          <small>JPG, PNG, or WebP · up to 2 MB</small>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="profile-name">DISPLAY NAME</label>
        <input id="profile-name" name="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} autoComplete="name" />
      </div>
      <div className="form-field">
        <label htmlFor="profile-location">HOME AREA</label>
        <input id="profile-location" name="location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Makati City" />
      </div>
      <button className="button button-accent" type="submit" disabled={busy || name.trim().length < 2}>{busy ? "Saving…" : "Save profile"}</button>
    </form>
  );
}

function NotificationSettings({ userId }: { userId: string }) {
  const [preferences, setPreferences] = useState<Record<string, boolean>>(defaultNotificationPreferences);
  const [saved, setSaved] = useState<Record<string, boolean>>(defaultNotificationPreferences);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { data, error } = await requireSupabase().rpc("get_my_profile").maybeSingle();
        if (error) throw error;
        const profile = data as { notification_preferences?: Record<string, boolean> | null } | null;
        if (alive && profile?.notification_preferences && typeof profile.notification_preferences === "object") {
          const merged = { ...defaultNotificationPreferences, ...profile.notification_preferences };
          setPreferences(merged);
          setSaved(merged);
        }
      } catch (reason) {
        if (alive) toast.error(reason instanceof Error ? reason.message : "Notification preferences could not be loaded.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  const dirty = JSON.stringify(preferences) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    try {
      const { error } = await requireSupabase().from("profiles").update({ notification_preferences: preferences }).eq("id", userId);
      if (error) throw error;
      setSaved(preferences);
      toast.success("Notification preferences saved.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Notification update failed.");
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ["organizer", "Organizer operations", "Registrations, court status, and venue events"],
    ["reminders", "Schedule reminders", "Upcoming sessions and competition dates"],
    ["messages", "Messages", "Replies and team communication"],
  ];

  return (
    <>
      <div className={`settings-preference-list ${loading ? "loading" : ""}`} aria-busy={loading}>
        {rows.map(([key, title, detail]) => (
          <div className="setting-row" key={key}>
            <span><Bell size={16} /></span>
            <div><strong>{title}</strong><small>{detail}</small></div>
            <button className={`switch ${preferences[key] ? "on" : ""}`} type="button" role="switch" aria-label={`${title} notifications`} aria-checked={Boolean(preferences[key])} disabled={loading || busy} onClick={() => setPreferences((current) => ({ ...current, [key]: !current[key] }))}><span /></button>
          </div>
        ))}
      </div>
      <button className="button button-accent settings-save-button" type="button" onClick={() => void save()} disabled={loading || busy || !dirty}>{loading ? "Loading preferences…" : busy ? "Saving…" : dirty ? "Save alerts" : "Saved"}</button>
    </>
  );
}
