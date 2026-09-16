import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpCircle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  Flag,
  Hourglass,
  MapPin,
  Megaphone,
  MessageCircle,
  Search,
  Trophy,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { requireSupabase } from "./supabase";

export type OrganizerNotification = {
  id: string;
  user_id: string;
  session_id: string | null;
  booking_id?: string | null;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type NotificationGroup = "TODAY" | "THIS WEEK" | "EARLIER";

const ICONS_BY_KIND: Record<string, LucideIcon> = {
  approval: CheckCircle2,
  waitlist_promotion: ArrowUpCircle,
  check_in_reminder: Clock,
  court_assignment: MapPin,
  match_point: Flag,
  result: Trophy,
  cancellation: XCircle,
  venue_announcement: Megaphone,
  booking_confirmed: CheckCircle2,
  booking_reminder: CalendarClock,
  court_waitlist: Hourglass,
  booking_changed: CalendarClock,
  match_invite: UserPlus,
  match_invite_response: CheckCircle2,
  match_found: Search,
  organizer_match: Activity,
  direct_message: MessageCircle,
  direct_message_request: UserPlus,
  direct_message_accepted: MessageCircle,
  follow_request: UserPlus,
  follow_accepted: Users,
};

export function iconForKind(kind: string): LucideIcon {
  return ICONS_BY_KIND[kind] || Bell;
}

export function groupForDate(createdAt: Date, now: Date = new Date()): NotificationGroup {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  if (createdAt >= today) return "TODAY";
  if (createdAt >= weekAgo) return "THIS WEEK";
  return "EARLIER";
}

export function timeLabelFor(createdAt: Date, group: NotificationGroup): string {
  if (Number.isNaN(createdAt.getTime())) return "Time unavailable";
  const options: Intl.DateTimeFormatOptions =
    group === "TODAY"
      ? { hour: "numeric", minute: "2-digit" }
      : group === "THIS WEEK"
        ? { weekday: "short", hour: "numeric", minute: "2-digit" }
        : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return createdAt.toLocaleString("en-PH", options);
}

export async function listNotifications(): Promise<OrganizerNotification[]> {
  const { data, error } = await requireSupabase()
    .from("user_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as OrganizerNotification[] | null) || [];
}

export async function markNotificationRead(id: string) {
  const { error } = await requireSupabase().rpc("mark_notification_read", { p_notification_id: id });
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { error } = await requireSupabase().rpc("mark_all_notifications_read");
  if (error) throw error;
}

export async function deleteNotification(id: string) {
  const { error } = await requireSupabase().rpc("delete_notification", { p_notification_id: id });
  if (error) throw error;
}

export async function clearReadNotifications() {
  const { error } = await requireSupabase().rpc("clear_read_notifications");
  if (error) throw error;
}
