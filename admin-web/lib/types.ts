export type AdminUser = {
  id: string;
  display_name: string;
  email: string;
  created_at: string;
  rating: number | null;
  is_banned: boolean;
  ban_reason: string | null;
  membership_tier: string | null;
  avatar_url: string | null;
};

export type AdminVenue = {
  id: string;
  name: string;
  area: string | null;
  address: string | null;
  court_count: number;
  verification_status: "pending" | "approved" | "rejected" | "suspended" | "verified";
  created_at: string;
  organizer_name: string | null;
  organizer_email: string | null;
};

export type AdminStats = {
  total_users: number;
  active_venues: number;
  sessions_this_month: number;
  gross_revenue: number;
};

export type MonthlySessionCount = {
  label: string;
  value: number;
};

export type ActivityItem = {
  id: string;
  type: "user_joined" | "venue_approved" | "venue_pending" | "user_banned";
  label: string;
  detail: string;
  created_at: string;
};

export type PlatformAdmin = {
  user_id: string;
  display_name: string;
  email: string;
  granted_at: string;
  granted_by_name: string | null;
};

export type AdminFinancialSummary = {
  platform_revenue_this_month: number;
  total_disbursed: number;
  cancellation_fees_retained: number;
  pending_withdrawal_count: number;
  pending_withdrawal_amount: number;
  withdrawal_large_amount_threshold: number;
  withdrawal_very_large_amount_threshold: number;
};

export type AdminWithdrawalRequest = {
  id: string;
  amount: number;
  payout_method: "gcash" | "bank_transfer" | "maya";
  payout_details: { account_name?: string; account_number?: string; bank_code?: string };
  status: "pending" | "approved" | "rejected" | "completed";
  rejection_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  venue_name: string;
  requested_by_name: string;
};

export type AdminRefundQueueItem = {
  id: string;
  booking_id: string;
  total_collected: number;
  refund_amount: number;
  owner_fee_retained: number;
  platform_fee_retained: number;
  status: "pending" | "processing" | "refunded" | "failed";
  created_at: string;
  reference: string;
  player_name: string;
  venue_name: string;
};
