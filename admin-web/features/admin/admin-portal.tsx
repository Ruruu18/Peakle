"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun, LogOut } from "lucide-react";
import { useAuth, useAdmin, useTheme } from "@/components/providers";
import LoginScreen from "@/components/login-screen";
import { adminNavigation } from "./config/admin-navigation";
import type { AdminSection } from "./config/admin-navigation";

// ─── Brand ───────────────────────────────────────────────────────────────────

function Brand() {
  return (
    <div className="brand" aria-label="Peakle Admin">
      <Image src="/ball_green.png" alt="" width={32} height={32} className="brand-logo" priority />
      <span className="brand-word">Peakle</span>
      <span className="brand-edition">ADMIN</span>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ section }: { section: AdminSection }) {
  return (
    <aside className="admin-sidebar">
      <div className="sidebar-brand">
        <Brand />
      </div>

      <nav className="sidebar-nav" aria-label="Admin navigation">
        {adminNavigation.map(({ section: sec, label, icon: Icon }) => (
          <Link
            key={sec}
            href={`/${sec}`}
            className={`nav-link ${section === sec ? "active" : ""}`}
            aria-current={section === sec ? "page" : undefined}
          >
            <Icon size={17} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-foot">
        <p className="sidebar-foot-label">Peakle Admin Portal</p>
      </div>
    </aside>
  );
}

// ─── Topbar ──────────────────────────────────────────────────────────────────

const SECTION_TITLES: Record<AdminSection, string> = {
  dashboard: "Dashboard",
  users: "Users",
  venues: "Venues",
  financials: "Financials",
  support: "Support",
  access: "Access",
};

function Topbar({ section, onSignOut }: { section: AdminSection; onSignOut: () => void }) {
  const { user } = useAuth();
  const { mode, toggle } = useTheme();

  const displayName = user?.user_metadata?.display_name as string | undefined
    ?? user?.email?.split("@")[0]
    ?? "Admin";

  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="admin-topbar">
      <div className="topbar-inner">
        <h1 className="topbar-title">{SECTION_TITLES[section]}</h1>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
          >
            {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="profile-chip">
            <div className="avatar">{initials}</div>
            <div>
              <strong>{displayName}</strong>
              <small>Platform Admin</small>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── AdminShell ──────────────────────────────────────────────────────────────

function sectionFromPathname(pathname: string): AdminSection {
  const match = adminNavigation.find(({ section: sec }) => pathname.startsWith(`/${sec}`));
  return match?.section ?? "dashboard";
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const section = sectionFromPathname(usePathname());
  const { user, loading: authLoading, signOut } = useAuth();
  const { isAdmin, adminLoading } = useAdmin();

  // Not authenticated → show login
  if (!authLoading && !user) {
    return <LoginScreen />;
  }

  // Loading state
  if (authLoading || adminLoading) {
    return (
      <div className="admin-loading-screen">
        <div className="admin-loading-inner">
          <Brand />
          <p>Verifying access…</p>
          <div className="loading-bar" />
        </div>
      </div>
    );
  }

  // Authenticated but not an admin
  if (user && !isAdmin) {
    return (
      <div className="admin-loading-screen">
        <div className="admin-loading-inner">
          <Brand />
          <div className="notice warning" style={{ marginTop: 24, textAlign: "left" }}>
            <strong>Admin access required</strong>
            <span>Your account does not have platform admin privileges.</span>
          </div>
          <button
            className="button button-ghost"
            style={{ marginTop: 16 }}
            onClick={() => signOut()}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-portal">
      <Sidebar section={section} />
      <div className="admin-workspace">
        <Topbar section={section} onSignOut={() => void signOut()} />
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
