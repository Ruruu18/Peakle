"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, Bell, Building2, CalendarDays, Download, LayoutDashboard, Menu, Moon, Plus, RefreshCw, Sun, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import LoginScreen, { Brand } from "@/components/login-screen";
import { useAuth, useTheme } from "@/components/providers";
import { CreateDialog, type CreateType } from "./dialogs/create-activity-dialog";
import { ProfileAvatar, SelectControl } from "./components/portal-ui";
import { SectionContent } from "./sections/section-content";
import { organizerNavigation, organizerPageCopy } from "./config/portal-navigation";
import { useOrganizerWorkspace } from "./hooks/use-organizer-workspace";
import type { OrganizerData, Venue } from "@/lib/types";
import type { PortalSection } from "@/lib/portal-sections";

export default function OrganizerPortal({ section, resourceId, subview }: { section: PortalSection; resourceId?: string; subview?: string }) {
  const { user, loading: authLoading } = useAuth();
  const { mode, toggle } = useTheme();
  const router = useRouter();
  const { data, loading, refreshing, error, venueId, setVenueId, refresh, hardRefresh } = useOrganizerWorkspace(user);
  const [mobileMore, setMobileMore] = useState(false);
  const [createType, setCreateType] = useState<CreateType | null>(null);
  useEffect(() => {
    if (!mobileMore && !createType) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [createType, mobileMore]);

  if (authLoading) return <LoadingScreen label="RESTORING YOUR WORKSPACE" />;
  if (!user) return <LoginScreen />;
  if (loading && !data) return <LoadingScreen label="GETTING THE COURTS READY" />;
  if (!data) return <WorkspaceFailure message={error || "The organizer workspace could not be loaded."} onRetry={hardRefresh} />;

  const currentVenue = data.venues.find((venue) => venue.id === venueId) ?? data.venues[0] ?? null;
  const pendingPlayers = data.registrations.filter((player) => player.registration_status === "requested").length;
  const currentCopy = organizerPageCopy[section];
  const primaryType: CreateType | null = section === "open-play" ? "session" : section === "programs" ? "program" : section === "competitions" ? "competition" : section === "memberships" ? "membership" : null;
  const canRefresh = section !== "settings";
  const navigate = (target: PortalSection) => { setMobileMore(false); router.push(`/${target}`); };

  return <main className="portal">
    <aside className="sidebar"><Brand light /><nav aria-label="Organizer navigation">{organizerNavigation.map((item) => <div key={item.section}>{item.group ? <p className="nav-group">{item.group}</p> : null}<Link className={`nav-link ${section === item.section ? "active" : ""}`} href={`/${item.section}`}><item.icon size={17} />{item.label}{item.section === "players" && pendingPlayers ? <span className="nav-badge">{pendingPlayers}</span> : null}</Link></div>)}</nav><div className="sidebar-foot"><div className="support-card"><strong>Need a hand?</strong><p>Organizer support is ready for venue operations and account access.</p><a href="mailto:support@peakle.app">CONTACT SUPPORT →</a></div></div></aside>
    <div className="workspace">
      <header className="topbar"><div className="topbar-inner"><div className="mobile-brand"><Brand /></div><div className="venue-switcher"><span><Building2 size={15} /></span><SelectControl className="venue-select" value={currentVenue?.id ?? ""} options={data.venues.length ? data.venues.map((venue) => ({ value: venue.id, label: venue.name, detail: venue.area || "Organizer venue" })) : [{ value: "", label: "No venue selected", detail: "Organizer workspace" }]} onChange={(value) => setVenueId(value || null)} ariaLabel="Current venue" disabled={!data.venues.length} /></div><div className="topbar-spacer" /><div className="topbar-actions"><button className="theme-button" type="button" onClick={toggle} aria-label={`Use ${mode === "dark" ? "light" : "dark"} mode`}>{mode === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button><Link className="icon-button notification-button" href="/notifications" aria-label="Notifications"><Bell size={17} /></Link><Link href="/settings" className="profile-chip"><ProfileAvatar name={data.profile.name} photo={data.profile.avatar} /><div><strong>{data.profile.name}</strong><small>{data.isAdmin ? "Platform admin" : `${data.entitlement?.tier || "organizer"} organizer`}</small></div></Link></div></div></header>
      <div className="content">{error ? <div className="notice warning"><strong>Workspace refresh failed</strong><span>{error}</span><button className="text-action" type="button" onClick={hardRefresh}>Try again</button></div> : null}<div className="page-head"><div><p className="eyebrow">{currentCopy.eyebrow}</p><h1>{section === "overview" ? `${currentCopy.title}, ${data.profile.name.split(" ")[0] || "Organizer"}.` : currentCopy.title}</h1><p>{currentCopy.detail}</p></div><div className="page-actions">{canRefresh ? <button className="button button-ghost" type="button" onClick={hardRefresh} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} size={15} /> {refreshing ? "Refreshing" : "Refresh"}</button> : null}{primaryType && !resourceId ? <button className="button button-accent" type="button" onClick={() => setCreateType(primaryType)}><Plus size={16} /> Create</button> : null}{section === "analytics" ? <button className="button button-accent" type="button" onClick={() => exportAnalytics(currentVenue, data.analytics ?? null)}><Download size={16} /> Export CSV</button> : null}</div></div><div className="kitchen-line" /><SectionContent section={section} data={data} venue={currentVenue} venueId={venueId} onVenueChange={setVenueId} navigate={navigate} refresh={refresh} onCreate={setCreateType} resourceId={resourceId} subview={subview} /></div>
    </div>
    <nav className="mobile-bottom-nav" aria-label="Mobile organizer navigation"><Link className={section === "overview" ? "active" : ""} href="/overview"><LayoutDashboard size={18} /><span>Overview</span></Link><Link className={section === "open-play" ? "active" : ""} href="/open-play"><CalendarDays size={18} /><span>Open Play</span></Link><Link className={`monitor ${section === "monitor" ? "active" : ""}`} href="/monitor"><Activity size={19} /><span>Monitor</span></Link><Link className={section === "players" ? "active" : ""} href="/players"><Users size={18} /><span>Players</span></Link><button className={organizerNavigation.slice(4).some((item) => item.section === section) ? "active" : ""} type="button" aria-expanded={mobileMore} aria-controls="mobile-more-menu" onClick={() => setMobileMore(true)}><Menu size={18} /><span>More</span></button></nav>
    {mobileMore ? <div id="mobile-more-menu" className="mobile-more" role="dialog" aria-modal="true" aria-label="More organizer tools"><div className="mobile-more-head"><div><Brand /><p>Venue management, reports, and account tools.</p></div><button className="icon-button" type="button" aria-label="Close organizer tools" onClick={() => setMobileMore(false)}><X size={18} /></button></div><div className="mobile-more-grid">{organizerNavigation.slice(4).map((item) => <Link className={section === item.section ? "active" : ""} key={item.section} href={`/${item.section}`} onClick={() => setMobileMore(false)}><span className="mobile-more-icon"><item.icon size={20} /></span><span>{item.label}</span></Link>)}</div></div> : null}
    {createType ? <CreateDialog type={createType} venue={currentVenue} userId={data.profile.id} onClose={() => setCreateType(null)} onCreated={() => { setCreateType(null); void refresh(); }} /> : null}
  </main>;
}

function WorkspaceFailure({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) { return <main className="workspace-failure"><Brand /><div className="failure-card"><span><RefreshCw size={22} /></span><p className="eyebrow">WORKSPACE UNAVAILABLE</p><h1>We couldn’t load your organizer data.</h1><p>{message}</p><button className="button button-accent" type="button" onClick={() => void onRetry()}>Try again <ArrowRight size={16} /></button></div></main>; }
function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-ball-stage">
          <div className="loading-ball-shadow" />
          <div className="loading-ball-trails" aria-hidden="true">
            <span /><span />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="loading-ball-img" src="/ball_green.png" alt="" aria-hidden="true" />
        </div>
        <p className="loading-label">{label}</p>
      </div>
    </div>
  );
}
function exportAnalytics(venue: Venue | null, analytics: OrganizerData["analytics"]) { if (!venue || !analytics) { toast.error("No analytics are available to export."); return; } const rows = [["Venue", venue.name], ["Bookings", analytics.bookings], ["Gross revenue PHP", analytics.grossRevenue], ["Court utilization", `${analytics.courtUtilization}%`], ["Unique players", analytics.uniquePlayers], ["Returning players", analytics.returningPlayers], ["Open play attendance", analytics.openPlayAttendance], ["Program registrations", analytics.programRegistrations]]; const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${venue.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-analytics.csv`; anchor.click(); URL.revokeObjectURL(url); toast.success("Analytics CSV downloaded."); }
