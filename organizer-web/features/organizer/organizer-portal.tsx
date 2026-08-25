"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, ArrowLeft, ArrowRight, Bell, Building2, CalendarDays, Download, LayoutDashboard, LifeBuoy, LogOut, Menu, Moon, Plus, RefreshCw, Sun, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import LoginScreen, { Brand } from "@/components/login-screen";
import { useAuth, useTheme } from "@/components/providers";
import { CreateDialog, type CreateType } from "./dialogs/create-activity-dialog";
import { ProfileAvatar, SelectControl, titleCase } from "./components/portal-ui";
import { organizerNavigation, organizerPageCopy } from "./config/portal-navigation";
import { useOrganizerWorkspace } from "./hooks/use-organizer-workspace";
import { OrganizerWorkspaceProvider } from "./workspace-context";
import { portalSections, type PortalSection } from "@/lib/portal-sections";
import type { OrganizerData, Venue } from "@/lib/types";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function sectionFromPathname(pathname: string): { section: PortalSection; hasDetail: boolean } {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "notifications") return { section: "settings", hasDetail: true };
  const candidate = segments[0] as PortalSection;
  const section = (portalSections as readonly string[]).includes(candidate) ? candidate : "overview";
  return { section, hasDetail: segments.length > 1 };
}

export default function OrganizerShell({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { mode, toggle } = useTheme();
  const router = useRouter();
  const { section, hasDetail } = sectionFromPathname(usePathname());
  const { data, loading, refreshing, error, venueId, setVenueId, refresh, hardRefresh } = useOrganizerWorkspace(user);
  const [mobileMore, setMobileMore] = useState(false);
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [signingOut, setSigningOut] = useState(false);
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
  const canSwitchVenue = data.venues.length > 1;
  const pendingPlayers = data.registrations.filter((player) => player.registration_status === "requested").length;
  const currentCopy = organizerPageCopy[section];
  const primaryType: CreateType | null = section === "open-play" ? "session" : section === "programs" ? "program" : section === "competitions" ? "competition" : section === "memberships" ? "membership" : null;
  const canRefresh = section !== "settings";
  const navigate = (target: PortalSection) => { setMobileMore(false); router.push(`/${target}`); };
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "We couldn’t log you out. Please try again.");
      setSigningOut(false);
    }
  };

  return <main className="portal">
    <aside className="sidebar"><Brand light /><nav aria-label="Organizer navigation">{organizerNavigation.map((item) => <div key={item.section}>{item.group ? <p className="nav-group">{item.group}</p> : null}<Link className={`nav-link ${section === item.section ? "active" : ""}`} href={`/${item.section}`} aria-current={section === item.section ? "page" : undefined}><item.icon size={17} />{item.label}{item.section === "players" && pendingPlayers ? <span className="nav-badge">{pendingPlayers}</span> : null}</Link></div>)}</nav><div className="sidebar-foot"><a className="sidebar-support" href="mailto:support@peakle.app"><LifeBuoy size={16} /><span>Help &amp; support</span></a><button className="sidebar-logout" type="button" onClick={() => void handleSignOut()} disabled={signingOut}><LogOut size={16} /><span>{signingOut ? "Logging out…" : "Log out"}</span></button></div></aside>
    <div className="workspace">
      <header className="topbar"><div className="topbar-inner"><div className="mobile-brand"><Brand /></div><div className={`venue-switcher ${canSwitchVenue ? "switchable" : "static"}`}><span className="venue-switcher-icon"><Building2 size={15} /></span>{canSwitchVenue ? <SelectControl className="venue-select" value={currentVenue?.id ?? ""} options={data.venues.map((venue) => ({ value: venue.id, label: venue.name, detail: venue.area || "Organizer venue" }))} onChange={(value) => setVenueId(value || null)} ariaLabel="Switch current venue" /> : <div className="venue-context-copy"><strong>{currentVenue?.name || "No venue selected"}</strong><small>{currentVenue?.area ? `Current venue · ${currentVenue.area}` : currentVenue ? "Current venue" : "Add a venue to begin"}</small></div>}</div><div className="topbar-spacer" /><div className="topbar-actions"><button className="theme-button" type="button" onClick={toggle} aria-label={`Use ${mode === "dark" ? "light" : "dark"} mode`}>{mode === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button><Link className="icon-button notification-button" href="/notifications" aria-label="Notifications"><Bell size={17} /></Link><Link href="/settings" className="profile-chip"><ProfileAvatar name={data.profile.name} photo={data.profile.avatar} /><div><strong>{data.profile.name}</strong><small>{data.isAdmin ? "Platform admin" : currentVenue ? `Venue ${titleCase(currentVenue.role)}` : "Organizer"}</small></div></Link></div></div></header>
      <div className="content">{error ? <div className="notice warning"><strong>Workspace refresh failed</strong><span>{error}</span><button className="text-action" type="button" onClick={hardRefresh}>Try again</button></div> : null}<div className="page-head"><div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>{hasDetail && section !== "overview" ? <Link href={`/${section}`} className="icon-button" style={{ marginTop: "4px" }} aria-label="Go back"><ArrowLeft size={18} /></Link> : null}<div style={{ minWidth: 0, flex: 1 }}><p className="eyebrow">{currentCopy.eyebrow}</p><h1>{section === "overview" ? `${getGreeting()}, ${data.profile.name.split(" ")[0] || "Organizer"}.` : currentCopy.title}</h1><p>{currentCopy.detail}</p></div></div><div className="page-actions">{section === "staff" && !hasDetail ? <Link className="button button-accent" href="/staff/invite"><Plus size={16} /> Add staff</Link> : null}{canRefresh ? <button className="button button-ghost" type="button" onClick={hardRefresh} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} size={15} /> {refreshing ? "Refreshing" : "Refresh"}</button> : null}{primaryType && !hasDetail ? <button className="button button-accent" type="button" onClick={() => setCreateType(primaryType)}><Plus size={16} /> Create</button> : null}{section === "analytics" ? <button className="button button-accent" type="button" onClick={() => exportAnalytics(currentVenue, data.analytics ?? null)}><Download size={16} /> Export CSV</button> : null}</div></div><div className="kitchen-line" /><OrganizerWorkspaceProvider value={{ data, venue: currentVenue, venueId, onVenueChange: setVenueId, navigate, refresh, onCreate: setCreateType }}>{children}</OrganizerWorkspaceProvider></div>
    </div>
    <nav className="mobile-bottom-nav" aria-label="Mobile organizer navigation"><Link className={section === "overview" ? "active" : ""} href="/overview"><LayoutDashboard size={18} /><span>Overview</span></Link><Link className={section === "open-play" ? "active" : ""} href="/open-play"><CalendarDays size={18} /><span>Open Play</span></Link><Link className={`monitor ${section === "monitor" ? "active" : ""}`} href="/monitor"><Activity size={19} /><span>Monitor</span></Link><Link className={section === "players" ? "active" : ""} href="/players"><Users size={18} /><span>Players</span></Link><button className={organizerNavigation.slice(4).some((item) => item.section === section) ? "active" : ""} type="button" aria-expanded={mobileMore} aria-controls="mobile-more-menu" onClick={() => setMobileMore(true)}><Menu size={18} /><span>More</span></button></nav>
    {mobileMore ? <div id="mobile-more-menu" className="mobile-more" role="dialog" aria-modal="true" aria-label="More organizer tools"><div className="mobile-more-head"><div><Brand /><p>Venue management, reports, and account tools.</p></div><button className="icon-button" type="button" aria-label="Close organizer tools" onClick={() => setMobileMore(false)}><X size={18} /></button></div><div className="mobile-more-grid">{organizerNavigation.slice(4).map((item) => <Link className={section === item.section ? "active" : ""} key={item.section} href={`/${item.section}`} aria-current={section === item.section ? "page" : undefined} onClick={() => setMobileMore(false)}><span className="mobile-more-icon"><item.icon size={20} /></span><span>{item.label}</span></Link>)}</div><div className="mobile-more-actions"><a href="mailto:support@peakle.app"><LifeBuoy size={17} />Help &amp; support</a><button type="button" onClick={() => void handleSignOut()} disabled={signingOut}><LogOut size={17} />{signingOut ? "Logging out…" : "Log out"}</button></div></div> : null}
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
