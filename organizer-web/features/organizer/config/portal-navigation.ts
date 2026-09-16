import type { LucideIcon } from "lucide-react";
import { Activity, BarChart3, Building2, CalendarCheck, CalendarDays, CircleDollarSign, KeyRound, LayoutDashboard, LifeBuoy, Settings, TicketCheck, Trophy, Users, Wallet } from "lucide-react";
import type { PortalSection } from "@/lib/portal-sections";

export type OrganizerNavItem = { section: PortalSection; label: string; icon: LucideIcon; group?: string };

export const organizerNavigation: OrganizerNavItem[] = [
  { section: "overview", label: "Overview", icon: LayoutDashboard, group: "WORKSPACE" },
  { section: "open-play", label: "Open Play", icon: CalendarDays },
  { section: "monitor", label: "Live Monitor", icon: Activity },
  { section: "players", label: "Players", icon: Users },
  { section: "bookings", label: "Bookings", icon: CalendarCheck, group: "RUN YOUR VENUE" },
  { section: "venues", label: "Venue & Courts", icon: Building2 },
  { section: "programs", label: "Programs", icon: TicketCheck },
  { section: "competitions", label: "Competition", icon: Trophy },
  { section: "memberships", label: "Memberships", icon: CircleDollarSign },
  { section: "analytics", label: "Analytics", icon: BarChart3, group: "INSIGHTS" },
  { section: "earnings", label: "Earnings", icon: Wallet },
  { section: "staff", label: "Staff Access", icon: KeyRound },
  { section: "support", label: "Support", icon: LifeBuoy, group: "ACCOUNT" },
  { section: "settings", label: "Settings", icon: Settings },
];

export const organizerPageCopy: Record<PortalSection, { eyebrow: string; title: string; detail: string }> = {
  overview: { eyebrow: "ORGANIZER WORKSPACE", title: "Good morning", detail: "A clean read on today’s courts, players, and venue activity." },
  bookings: { eyebrow: "COURT RESERVATIONS", title: "Bookings", detail: "Every court reservation at your venue, its payment status, and who booked it." },
  "open-play": { eyebrow: "SESSION OPERATIONS", title: "Open Play", detail: "Publish sessions, manage registration, and keep every court moving." },
  monitor: { eyebrow: "OPEN PLAY · LIVE", title: "Court monitor", detail: "Follow live scores, open courts, and the player queue in real time." },
  players: { eyebrow: "SESSION OPERATIONS", title: "Players", detail: "Review registration, check players in, and manage attendance." },
  venues: { eyebrow: "VENUE OPERATIONS", title: "Venue & courts", detail: "Manage the facility details players rely on before they book." },
  programs: { eyebrow: "ACTIVITIES", title: "Programs", detail: "Clinics, coaching, camps, and recurring development sessions." },
  competitions: { eyebrow: "COMPETITION", title: "Competitions", detail: "Registration, divisions, brackets, schedules, and official results." },
  memberships: { eyebrow: "COMMERCIAL", title: "Memberships", detail: "Court packs, session credits, venue memberships, and discounts." },
  analytics: { eyebrow: "INSIGHTS & REPORTS", title: "Venue analytics", detail: "Revenue, utilization, attendance, and player retention." },
  earnings: { eyebrow: "PAYOUTS", title: "Earnings", detail: "Your balance, payout history, and withdrawal requests." },
  staff: { eyebrow: "VENUE OPERATIONS", title: "Staff access", detail: "Give every teammate exactly the access their role requires." },
  support: { eyebrow: "ACCOUNT", title: "Support", detail: "Chat with Peakle support — AI-answered instantly, with a teammate a message away." },
  notifications: { eyebrow: "INBOX", title: "Notifications", detail: "Booking activity, court alerts, and account updates for your organizer account." },
  settings: { eyebrow: "ACCOUNT", title: "Organizer settings", detail: "Manage your profile, preferences, notifications, and security." },
};
