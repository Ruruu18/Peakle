"use client";

import Link from "next/link";
import { Bell, Camera, ExternalLink, KeyRound, Moon, ShieldCheck, Sun, Trash2, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth, useTheme } from "@/components/providers";
import { requireSupabase } from "@/lib/supabase";
import { deleteProfilePhoto, uploadProfilePhoto, validateProfilePhoto } from "@/lib/profile-photo";
import type { OrganizerData } from "@/lib/types";
import { ProfileAvatar, SettingRow, titleCase } from "../components/portal-ui";

export function SettingsSection({ data, subview, refresh }: { data: OrganizerData; subview?: string; refresh: () => Promise<void> }) {
  const { mode, toggle } = useTheme();
  const { signOut } = useAuth();
  if (subview === "profile") return <ProfileSettings data={data} refresh={refresh} />;
  if (subview === "notifications") return <NotificationSettings userId={data.profile.id} />;
  if (subview === "security") return <SettingsPage title="Security and sessions" detail="Manage the current organizer browser session."><button className="button button-accent" type="button" onClick={signOut}>Sign out this session</button></SettingsPage>;
  if (subview === "player-app") return <SettingsPage title="Player mobile app" detail="Return to your player experience on Peakle."><a className="button button-accent inline-action" href="peakle://">Open Peakle app</a></SettingsPage>;
  return <div className="settings-grid"><div className="card profile-card"><ProfileAvatar name={data.profile.name} photo={data.profile.avatar} /><h2>{data.profile.name}</h2><p>{data.profile.email}<br />{data.profile.location}</p><div className="plan-badge"><strong>{data.isAdmin ? "Platform Admin" : `Organizer ${titleCase(data.entitlement?.tier)}`}</strong><small>{data.entitlement?.status === "active" ? "Full workspace access" : titleCase(data.entitlement?.status)}</small></div></div><div className="card setting-list"><SettingRow icon={UserCheck} title="Shared Peakle identity" detail="Name and profile photo stay synchronized with the player app" action="Edit" href="/settings/profile" /><SettingRow icon={mode === "dark" ? Moon : Sun} title="Appearance" detail={`${titleCase(mode)} mode is active on this browser`} action="Toggle" onAction={toggle} /><SettingRow icon={Bell} title="Organizer alerts" detail="Court, registration, and competition notifications" action="Manage" href="/settings/notifications" /><SettingRow icon={ShieldCheck} title="Security and sessions" detail="Password, Google sign-in, and active devices" action="Review" href="/settings/security" /><SettingRow icon={ExternalLink} title="Player mobile app" detail="Return to your player experience on Peakle" action="Open" href="/settings/player-app" /><div className="setting-row"><span><KeyRound size={16} /></span><div><strong>Sign out</strong><small>End this organizer browser session</small></div><button className="mini-button" type="button" onClick={signOut}>Sign out</button></div></div></div>;
}

function SettingsPage({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return <div className="management-grid"><div className="card management-card"><div className="card-topline"><span className="card-kicker">ACCOUNT SETTINGS</span><Link className="text-action" href="/settings">BACK →</Link></div><h2>{title}</h2><p>{detail}</p>{children}</div></div>;
}

function ProfileSettings({ data, refresh }: { data: OrganizerData; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      const nextAvatar = photo ? await uploadProfilePhoto(data.profile.id, photo) : removePhoto ? null : data.profile.avatar;
      const { error } = await requireSupabase().from("profiles").update({ display_name: String(values.get("name") || "").trim(), home_area: String(values.get("location") || "").trim() || null, avatar_url: nextAvatar }).eq("id", data.profile.id);
      if (error) throw error;
      if ((photo || removePhoto) && data.profile.avatar && data.profile.avatar !== nextAvatar) void deleteProfilePhoto(data.profile.avatar).catch(() => undefined);
      await refresh();
      setPhoto(null);
      setPreview(null);
      setRemovePhoto(false);
      toast.success("Profile updated across Peakle.");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Profile update failed."); }
    finally { setBusy(false); }
  };
  const shownPhoto = removePhoto ? null : preview || data.profile.avatar;
  return <SettingsPage title="Shared Peakle identity" detail="Changes here are synchronized with your player profile."><form className="management-form" onSubmit={submit}><div className="profile-photo-field"><ProfileAvatar name={data.profile.name} photo={shownPhoto} /><div><label className="mini-button inline-action" htmlFor="profile-photo"><Camera size={14} />{shownPhoto ? "Change photo" : "Add photo"}</label><input className="file-input" id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0] || null; try { if (file) validateProfilePhoto(file); setPhoto(file); setPreview(file ? URL.createObjectURL(file) : null); setRemovePhoto(false); } catch (reason) { event.currentTarget.value = ""; toast.error(reason instanceof Error ? reason.message : "Invalid profile photo."); } }} />{shownPhoto ? <button className="mini-button profile-photo-remove" type="button" onClick={() => { setPhoto(null); setPreview(null); setRemovePhoto(true); }}><Trash2 size={14} />Remove</button> : null}<small>JPG, PNG, or WebP · up to 2 MB</small></div></div><div className="form-field"><label htmlFor="profile-name">DISPLAY NAME</label><input id="profile-name" name="name" defaultValue={data.profile.name} required minLength={2} /></div><div className="form-field"><label htmlFor="profile-location">HOME AREA</label><input id="profile-location" name="location" defaultValue={data.profile.location || ""} /></div><button className="button button-accent" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></form></SettingsPage>;
}

function NotificationSettings({ userId }: { userId: string }) {
  const [preferences, setPreferences] = useState<Record<string, boolean>>({ organizer: true, reminders: true, messages: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void requireSupabase().from("profiles").select("notification_preferences").eq("id", userId).maybeSingle().then(({ data }) => {
      if (alive && data?.notification_preferences && typeof data.notification_preferences === "object") setPreferences((current) => ({ ...current, ...(data.notification_preferences as Record<string, boolean>) }));
    });
    return () => { alive = false; };
  }, [userId]);
  const save = async () => {
    setBusy(true);
    try {
      const { error } = await requireSupabase().from("profiles").update({ notification_preferences: preferences }).eq("id", userId);
      if (error) throw error;
      toast.success("Notification preferences saved.");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Notification update failed."); }
    finally { setBusy(false); }
  };
  return <SettingsPage title="Organizer alerts" detail="Choose which updates should reach your Peakle account."><div className="card setting-list">{[["organizer", "Organizer operations", "Registrations, court status, and venue events"], ["reminders", "Schedule reminders", "Upcoming sessions and competition dates"], ["messages", "Messages", "Replies and team communication"]].map(([key, title, detail]) => <div className="setting-row" key={key}><span><Bell size={16} /></span><div><strong>{title}</strong><small>{detail}</small></div><button className={`switch ${preferences[key] ? "on" : ""}`} type="button" role="switch" aria-checked={Boolean(preferences[key])} onClick={() => setPreferences((current) => ({ ...current, [key]: !current[key] }))}><span /></button></div>)}</div><button className="button button-accent" type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save alerts"}</button></SettingsPage>;
}
