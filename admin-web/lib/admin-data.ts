import { requireSupabase } from "./supabase";
import type {
  AdminUser,
  AdminVenue,
  AdminStats,
  ActivityItem,
  MonthlySessionCount,
  PlatformAdmin,
  AdminFinancialSummary,
  AdminWithdrawalRequest,
  AdminRefundQueueItem,
} from "./types";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function assertPlatformAdmin(): Promise<void> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) throw new Error(`Admin check failed: ${error.message}`);
  if (!data) throw new Error("Unauthorized: platform admin access required.");
}

export async function fetchAdminStats(): Promise<AdminStats> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [usersResult, venuesResult, sessionsResult, revenueResult] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .in("verification_status", ["verified", "approved"]),
    supabase
      .from("open_play_sessions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart),
    supabase.rpc("admin_get_gross_revenue_this_month"),
  ]);

  const failed = [usersResult, venuesResult, sessionsResult, revenueResult].find((result) => result.error);
  if (failed?.error) throw new Error(`Failed to load admin stats: ${failed.error.message}`);

  return {
    total_users: usersResult.count ?? 0,
    active_venues: venuesResult.count ?? 0,
    sessions_this_month: sessionsResult.count ?? 0,
    gross_revenue: Number(revenueResult.data ?? 0),
  };
}

export async function fetchSessionsTrend(): Promise<MonthlySessionCount[]> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const now = new Date();
  const ranges = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const end = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1);
    return { label: MONTH_LABELS[start.getMonth()], start: start.toISOString(), end: end.toISOString() };
  });

  const results = await Promise.all(
    ranges.map(({ start, end }) =>
      supabase
        .from("open_play_sessions")
        .select("id", { count: "exact", head: true })
        .gte("created_at", start)
        .lt("created_at", end),
    ),
  );

  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`Failed to load sessions trend: ${failed.error.message}`);

  return ranges.map(({ label }, i) => ({ label, value: results[i].count ?? 0 }));
}

export async function fetchRecentActivity(): Promise<ActivityItem[]> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const [recentUsers, recentVenues] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("venues")
      .select("id, name, verification_status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const failed = [recentUsers, recentVenues].find((result) => result.error);
  if (failed?.error) throw new Error(`Failed to load recent activity: ${failed.error.message}`);

  const items: ActivityItem[] = [];

  for (const user of recentUsers.data ?? []) {
    items.push({
      id: `user-${user.id}`,
      type: "user_joined",
      label: user.display_name ?? "Unknown user",
      detail: "Joined Peakle",
      created_at: user.created_at,
    });
  }

  for (const venue of recentVenues.data ?? []) {
    const vs = venue.verification_status as string;
    const type: ActivityItem["type"] =
      vs === "verified" || vs === "approved"
        ? "venue_approved"
        : "venue_pending";
    items.push({
      id: `venue-${venue.id}`,
      type,
      label: venue.name ?? "Unknown venue",
      detail:
        vs === "verified" || vs === "approved"
          ? "Venue approved"
          : "Venue pending review",
      created_at: venue.created_at,
    });
  }

  items.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return items.slice(0, 10);
}

export async function fetchUsers(search = ""): Promise<AdminUser[]> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc("admin_list_users", { p_search: search.trim(), p_limit: 100 });
  if (error) throw new Error(`Failed to fetch users: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    display_name: (row.display_name as string | null) ?? "",
    email: (row.email as string | null) ?? "",
    created_at: row.created_at as string,
    rating: (row.rating as number | null) ?? null,
    is_banned: Boolean(row.is_banned),
    ban_reason: (row.ban_reason as string | null) ?? null,
    membership_tier: (row.membership_tier as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
  }));
}

export async function fetchUserDetail(userId: string): Promise<AdminUser> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc("admin_get_user", { p_user_id: userId }).single();
  if (error) throw new Error(`Failed to fetch user: ${error.message}`);

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    display_name: (row.display_name as string | null) ?? "",
    email: (row.email as string | null) ?? "",
    created_at: row.created_at as string,
    rating: (row.rating as number | null) ?? null,
    is_banned: Boolean(row.is_banned),
    ban_reason: (row.ban_reason as string | null) ?? null,
    membership_tier: (row.membership_tier as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
  };
}

export async function banUser(userId: string, reason: string): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { error } = await supabase.rpc("admin_ban_user", { p_user_id: userId, p_reason: reason });
  if (error) throw new Error(`Failed to ban user: ${error.message}`);
}

export async function unbanUser(userId: string): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { error } = await supabase.rpc("admin_unban_user", { p_user_id: userId });
  if (error) throw new Error(`Failed to unban user: ${error.message}`);
}

export async function fetchVenues(filter: "all" | "pending" = "all"): Promise<AdminVenue[]> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  let query = supabase
    .from("venues")
    .select("id, name, area, address, verification_status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter === "pending") {
    query = query.eq("verification_status", "pending");
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch venues: ${error.message}`);

  // Fetch court counts separately
  const venueIds = (data ?? []).map((v) => v.id);
  let courtCounts: Record<string, number> = {};

  if (venueIds.length > 0) {
    const { data: courts } = await supabase
      .from("courts")
      .select("venue_id")
      .in("venue_id", venueIds);
    for (const court of courts ?? []) {
      courtCounts[court.venue_id] = (courtCounts[court.venue_id] ?? 0) + 1;
    }
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name ?? "",
    area: row.area ?? null,
    address: row.address ?? null,
    court_count: courtCounts[row.id] ?? 0,
    verification_status: (row.verification_status ?? "pending") as AdminVenue["verification_status"],
    created_at: row.created_at,
    organizer_name: null,
    organizer_email: null,
  }));
}

export async function fetchVenueDetail(venueId: string): Promise<AdminVenue> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("venues")
    .select("id, name, area, address, verification_status, created_at")
    .eq("id", venueId)
    .single();

  if (error) throw new Error(`Failed to fetch venue: ${error.message}`);

  const { count: courtCount } = await supabase
    .from("courts")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId);

  return {
    id: data.id,
    name: data.name ?? "",
    area: data.area ?? null,
    address: data.address ?? null,
    court_count: courtCount ?? 0,
    verification_status: (data.verification_status ?? "pending") as AdminVenue["verification_status"],
    created_at: data.created_at,
    organizer_name: null,
    organizer_email: null,
  };
}

export async function updateVenueStatus(
  venueId: string,
  status: AdminVenue["verification_status"],
): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { error } = await supabase
    .from("venues")
    .update({ verification_status: status })
    .eq("id", venueId);

  if (error) throw new Error(`Failed to update venue status: ${error.message}`);
}

export async function fetchPlatformAdmins(): Promise<PlatformAdmin[]> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc("admin_list_platform_admins");
  if (error) throw new Error(`Failed to fetch platform admins: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    user_id: row.user_id as string,
    display_name: (row.display_name as string | null) ?? "",
    email: (row.email as string | null) ?? "",
    granted_at: row.granted_at as string,
    granted_by_name: (row.granted_by_name as string | null) ?? null,
  }));
}

export async function addPlatformAdmin(email: string): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { data: match, error: lookupError } = await supabase
    .rpc("admin_find_user_by_email", { p_email: email.trim() })
    .maybeSingle();

  if (lookupError) throw new Error(`Failed to look up user: ${lookupError.message}`);
  if (!match) {
    throw new Error(`No user found matching "${email}".`);
  }

  const userId = (match as Record<string, unknown>).user_id as string;

  const { error } = await supabase
    .from("platform_admins")
    .insert({ user_id: userId });

  if (error) throw new Error(`Failed to add admin: ${error.message}`);
}

export async function removePlatformAdmin(userId: string): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { error } = await supabase
    .from("platform_admins")
    .delete()
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to remove admin: ${error.message}`);
}

export async function fetchFinancialSummary(): Promise<AdminFinancialSummary> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc("admin_get_financial_summary");
  if (error) throw new Error(`Failed to fetch financial summary: ${error.message}`);
  return data as AdminFinancialSummary;
}

export async function fetchWithdrawalQueue(): Promise<AdminWithdrawalRequest[]> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc("admin_list_withdrawal_requests");
  if (error) throw new Error(`Failed to fetch withdrawal queue: ${error.message}`);
  return (data ?? []) as AdminWithdrawalRequest[];
}

export async function fetchRefundQueue(): Promise<AdminRefundQueueItem[]> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();

  const { data, error } = await supabase.rpc("admin_list_refund_queue");
  if (error) throw new Error(`Failed to fetch refund queue: ${error.message}`);
  return (data ?? []) as AdminRefundQueueItem[];
}

export async function approveWithdrawal(id: string): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();
  const { error } = await supabase.rpc("admin_approve_withdrawal", { p_id: id });
  if (error) throw new Error(`Failed to approve withdrawal: ${error.message}`);
}

export async function rejectWithdrawal(id: string, note: string): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();
  const { error } = await supabase.rpc("admin_reject_withdrawal", { p_id: id, p_note: note });
  if (error) throw new Error(`Failed to reject withdrawal: ${error.message}`);
}

export async function completeWithdrawal(id: string, note?: string): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();
  const { error } = await supabase.rpc("admin_complete_withdrawal", { p_id: id, p_note: note ?? null });
  if (error) throw new Error(`Failed to complete withdrawal: ${error.message}`);
}

export async function retryRefund(bookingId: string): Promise<void> {
  await assertPlatformAdmin();
  const supabase = requireSupabase();
  const { data, error } = await supabase.functions.invoke("process-refund", { body: { booking_id: bookingId } });
  if (error) throw new Error(`Failed to process refund: ${error.message}`);
  if (data?.error) throw new Error(data.error);
}
