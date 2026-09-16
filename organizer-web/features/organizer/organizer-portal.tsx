"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bell, Building2, Download, LayoutDashboard, LogOut, Moon, Plus, RefreshCw, Sparkles, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import LoginScreen, { Brand } from "@/components/login-screen";
import { useAuth, useTheme } from "@/components/providers";
import { CreateDialog, type CreateType } from "./dialogs/create-activity-dialog";
import { SupportWidget } from "./components/support-widget";
import { MobileNavigation } from "./components/mobile-navigation";
import { ProfileAvatar, SelectControl, titleCase } from "./components/portal-ui";
import { organizerNavigation, organizerPageCopy } from "./config/portal-navigation";
import { useNotifications } from "./hooks/use-notifications";
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
  const candidate = segments[0] as PortalSection;
  const section = (portalSections as readonly string[]).includes(candidate) ? candidate : "overview";
  return { section, hasDetail: segments.length > 1 };
}

export default function OrganizerShell({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, signOut, isDemo } = useAuth();
  const { mode, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { section, hasDetail } = sectionFromPathname(pathname);
  const isRosterPage = /^\/open-play\/[^/]+\/players\/?$/.test(pathname);
  const { data, loading, refreshing, error, venueId, setVenueId, refresh, hardRefresh } = useOrganizerWorkspace(user);
  const { unreadCount } = useNotifications(user);
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    if (!createType) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [createType]);

  if (authLoading) return <LoadingScreen label="RESTORING YOUR WORKSPACE" />;
  if (!user) return <LoginScreen />;
  if (signingOut) return <LoadingScreen label="LOGGING OUT" />;
  if (loading && !data) return <LoadingScreen label="GETTING THE COURTS READY" />;
  if (!data) return <WorkspaceFailure message={error || "The organizer workspace could not be loaded."} onRetry={hardRefresh} />;

  const currentVenue = data.venues.find((venue) => venue.id === venueId) ?? data.venues[0] ?? null;
  const canSwitchVenue = data.venues.length > 1;
  const pendingPlayers = data.registrations.filter((player) => player.registration_status === "requested").length;
  const currentCopy = organizerPageCopy[section];
  const rosterSessionId = isRosterPage ? pathname.split("/")[2] : null;
  const isArchivedRoster = isRosterPage && data.archivedSessions.some((session) => session.id === rosterSessionId);
  const backHref = isRosterPage ? (isArchivedRoster ? "/open-play/archive" : `/open-play/${rosterSessionId}`) : `/${section}`;
  const backLabel = isRosterPage ? (isArchivedRoster ? "Back to archive" : "Back to session") : `Back to ${currentCopy.title}`;
  const SectionIcon = section === "notifications" ? Bell : organizerNavigation.find((item) => item.section === section)?.icon ?? LayoutDashboard;
  const primaryType: CreateType | null = section === "open-play" ? "session" : section === "programs" && currentVenue && ["owner", "manager", "admin"].includes(currentVenue.role) ? "program" : section === "competitions" ? "competition" : section === "memberships" ? "membership" : null;
  const canRefresh = section !== "settings" && section !== "notifications";
  const venueSwitcher = currentVenue ? (
    <div className={`venue-switcher ${canSwitchVenue ? "switchable" : "static"}`}>
      <span className="venue-switcher-icon"><Building2 size={15} /></span>
      {canSwitchVenue ? (
        <SelectControl className="venue-select" value={currentVenue.id} options={data.venues.map((venue) => ({ value: venue.id, label: venue.name, detail: venue.area || "Organizer venue" }))} onChange={(value) => setVenueId(value || null)} ariaLabel="Switch current venue" />
      ) : (
        <div className="venue-context-copy"><strong>{currentVenue.name}</strong><small>{currentVenue.area ? `Current venue · ${currentVenue.area}` : "Current venue"}</small></div>
      )}
    </div>
  ) : (
    <Link className="venue-switcher venue-switcher-empty" href="/venues" aria-label="Add your first venue">
      <span className="venue-switcher-icon"><Building2 size={15} /></span>
      <div className="venue-context-copy"><strong>Add your first venue</strong><small>Set up courts and bookings</small></div>
      <ArrowRight className="venue-switcher-arrow" size={15} />
    </Link>
  );
  const navigate = (target: PortalSection) => { router.push(`/${target}`); };
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/login");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "We couldn’t log you out. Please try again.");
      setSigningOut(false);
    }
  };

  return <>
    {isDemo ? <div className="demo-mode-banner" role="status"><span className="demo-mode-banner-icon"><Sparkles size={14} /></span><span>You&apos;re exploring a live demo workspace with sample data — nothing here is saved.</span><button type="button" onClick={() => void handleSignOut()} disabled={signingOut}>{signingOut ? "Exiting…" : "Exit demo"}</button></div> : null}
    <main className="portal">
    <aside className="sidebar"><div className="sidebar-brand-row"><Brand light />{isDemo ? <span className="demo-mode-pill">DEMO</span> : null}</div><nav aria-label="Organizer navigation">{organizerNavigation.map((item) => <div key={item.section}>{item.group ? <p className="nav-group">{item.group}</p> : null}<Link className={`nav-link ${section === item.section ? "active" : ""}`} href={`/${item.section}`} aria-current={section === item.section ? "page" : undefined}><item.icon size={17} />{item.label}{item.section === "players" && pendingPlayers ? <span className="nav-badge">{pendingPlayers}</span> : null}</Link></div>)}</nav><div className="sidebar-foot"><button className="sidebar-logout" type="button" onClick={() => void handleSignOut()} disabled={signingOut}><LogOut size={16} /><span>{signingOut ? "Logging out…" : "Log out"}</span></button></div></aside>
    <div className="workspace">
      <header className="topbar"><div className="topbar-inner"><div className="mobile-brand"><Brand /></div>{venueSwitcher}<div className="topbar-spacer" /><div className="topbar-actions"><button className="theme-button" type="button" onClick={toggle} aria-label={`Use ${mode === "dark" ? "light" : "dark"} mode`}>{mode === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button><Link className="icon-button notification-button" href="/notifications" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}><Bell size={17} />{unreadCount > 0 ? <span className="notification-badge-dot" aria-hidden="true" /> : null}</Link><Link href="/settings/profile" className="profile-chip" aria-label="View your profile" aria-current={pathname === "/settings/profile" ? "page" : undefined}><ProfileAvatar name={data.profile.name} photo={data.profile.avatar} /><div><strong>{data.profile.name}</strong><small>{data.isAdmin ? "Platform admin" : currentVenue ? `Venue ${titleCase(currentVenue.role)}` : "Organizer"}</small></div></Link></div></div></header>
      <div className={`content${isRosterPage ? " roster-content" : ""}`}>
        {error ? <div className="notice warning"><strong>Workspace refresh failed</strong><span>{error}</span><button className="text-action" type="button" onClick={hardRefresh}>Try again</button></div> : null}
        <div className="page-head">
          <div className="page-head-top">
            {hasDetail && section !== "overview" && section !== "settings" ? <Link href={backHref} className="page-head-back" style={isRosterPage ? undefined : { marginBottom: 12 }} aria-label={backLabel}><ArrowLeft size={14} />{backLabel}</Link> : null}
            {!hasDetail ? <div className="page-head-body"><div className="page-head-icon-row"><span className="page-head-icon"><SectionIcon size={19} /></span></div><div style={{ minWidth: 0, flex: 1 }}><p className="eyebrow">{currentCopy.eyebrow}</p><h1>{section === "overview" ? `${getGreeting()}, ${data.profile.name.split(" ")[0] || "Organizer"}.` : currentCopy.title}</h1><p>{currentCopy.detail}</p></div></div> : null}
          </div>
          <div className="page-actions">
            {section === "staff" && !hasDetail ? <Link className="button button-accent" href="/staff/add"><Plus size={16} /> Add staff</Link> : null}
            {canRefresh ? <button className="button button-ghost" type="button" onClick={hardRefresh} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} size={15} /> {refreshing ? "Refreshing" : "Refresh"}</button> : null}
            {primaryType && !hasDetail ? <button className="button button-accent" type="button" onClick={() => setCreateType(primaryType)}><Plus size={16} /> Create</button> : null}
            {section === "analytics" ? <button className="button button-accent" type="button" onClick={() => exportAnalytics(currentVenue, data.analytics ?? null)}><Download size={16} /> Export CSV</button> : null}
          </div>
        </div>
        {isRosterPage ? null : <div className="kitchen-line" />}
        <OrganizerWorkspaceProvider value={{ data, venue: currentVenue, venueId, onVenueChange: setVenueId, navigate, refresh, onCreate: setCreateType }}>{children}</OrganizerWorkspaceProvider>
      </div>
    </div>
    {/* Reset the menu on navigation, including browser Back and Forward. */}
    <MobileNavigation key={pathname} section={section} signingOut={signingOut} onSignOut={handleSignOut} />
    {createType ? <CreateDialog type={createType} venue={currentVenue} userId={data.profile.id} onClose={() => setCreateType(null)} onCreated={() => { setCreateType(null); void refresh(); }} /> : null}
    {section !== "support" ? <SupportWidget /> : null}
  </main>
  </>;
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
