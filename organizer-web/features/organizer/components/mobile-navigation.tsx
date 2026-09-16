"use client";

import Link from "next/link";
import { Activity, CalendarDays, LayoutDashboard, LogOut, Menu, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/login-screen";
import type { PortalSection } from "@/lib/portal-sections";
import { organizerNavigation } from "../config/portal-navigation";

const primaryNavigation = [
  { section: "overview", label: "Overview", icon: LayoutDashboard },
  { section: "open-play", label: "Open Play", icon: CalendarDays },
  { section: "monitor", label: "Monitor", icon: Activity },
  { section: "players", label: "Players", icon: Users },
] as const;

export function MobileNavigation({ section, signingOut, onSignOut }: { section: PortalSection; signingOut: boolean; onSignOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const moreNavigation = organizerNavigation.filter((item) => !primaryNavigation.some((primary) => primary.section === item.section));

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    const mobileViewport = window.matchMedia("(max-width: 820px)");
    const previousOverflow = document.body.style.overflow;
    const closeOnDesktop = () => { if (!mobileViewport.matches) setOpen(false); };

    dialog?.showModal();
    document.body.style.overflow = "hidden";
    mobileViewport.addEventListener("change", closeOnDesktop);

    return () => {
      mobileViewport.removeEventListener("change", closeOnDesktop);
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const controls = event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return <>
    <nav className="mobile-bottom-nav" aria-label="Mobile organizer navigation">
      {primaryNavigation.map((item) => (
        <Link key={item.section} className={`${item.section === "monitor" ? "monitor " : ""}${section === item.section ? "active" : ""}`} href={`/${item.section}`} aria-current={section === item.section ? "page" : undefined}>
          <item.icon size={item.section === "monitor" ? 19 : 18} /><span>{item.label}</span>
        </Link>
      ))}
      <button ref={triggerRef} className={moreNavigation.some((item) => item.section === section) ? "active" : ""} type="button" aria-expanded={open} aria-controls="mobile-more-menu" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Menu size={18} /><span>More</span>
      </button>
    </nav>
    {open ? (
      <dialog ref={dialogRef} id="mobile-more-menu" className="mobile-more" aria-label="More organizer tools" onKeyDown={handleMenuKeys} onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
        <div className="mobile-more-head">
          <div><Brand /><p>Venue management, reports, and account tools.</p></div>
          <button className="icon-button" type="button" aria-label="Close organizer tools" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <div className="mobile-more-grid">
          {moreNavigation.map((item) => (
            <Link className={section === item.section ? "active" : ""} key={item.section} href={`/${item.section}`} aria-current={section === item.section ? "page" : undefined} onClick={() => setOpen(false)}>
              <span className="mobile-more-icon"><item.icon size={20} /></span><span>{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="mobile-more-actions">
          <button type="button" onClick={() => void onSignOut()} disabled={signingOut}><LogOut size={17} />{signingOut ? "Logging out…" : "Log out"}</button>
        </div>
      </dialog>
    ) : null}
  </>;
}
