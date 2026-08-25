"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, CircleDollarSign, Clock3, RotateCcw } from "lucide-react";
import { Badge, ConfirmDialog, StatCard, Tabs } from "@/components/admin-ui";
import {
  approveWithdrawal,
  completeWithdrawal,
  fetchFinancialSummary,
  fetchRefundQueue,
  fetchWithdrawalQueue,
  rejectWithdrawal,
  retryRefund,
} from "@/lib/admin-data";
import type { AdminFinancialSummary, AdminRefundQueueItem, AdminWithdrawalRequest } from "@/lib/types";

const money = (value?: number | null) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(Number(value || 0));

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function amountTierBadge(amount: number, summary: AdminFinancialSummary | null) {
  if (!summary) return null;
  if (amount >= summary.withdrawal_very_large_amount_threshold) {
    return <span className="badge badge-danger">Very large</span>;
  }
  if (amount >= summary.withdrawal_large_amount_threshold) {
    return <span className="badge badge-pending">Large</span>;
  }
  return null;
}

export default function FinancialsSection() {
  const [summary, setSummary] = useState<AdminFinancialSummary | null>(null);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawalRequest[]>([]);
  const [refunds, setRefunds] = useState<AdminRefundQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"withdrawals" | "refunds">("withdrawals");
  const [rejecting, setRejecting] = useState<AdminWithdrawalRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, withdrawalData, refundData] = await Promise.all([
        fetchFinancialSummary(),
        fetchWithdrawalQueue(),
        fetchRefundQueue(),
      ]);
      setSummary(summaryData);
      setWithdrawals(withdrawalData);
      setRefunds(refundData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load financials.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try { await action(); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed."); }
    finally { setBusyId(null); }
  };

  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending");
  const pendingRefunds = refunds.filter((r) => r.status === "pending" || r.status === "failed");

  return (
    <div className="section-content">
      <div className="page-head">
        <div>
          <p className="eyebrow">PLATFORM FINANCIALS</p>
          <h1>Financials</h1>
          <p>Platform revenue, venue payouts, and player refunds.</p>
        </div>
      </div>

      {error && (
        <div className="notice warning" style={{ marginBottom: 24 }}>
          <strong>Error</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Revenue This Month" value={money(summary?.platform_revenue_this_month)} icon={CircleDollarSign} />
        <StatCard label="Total Disbursed" value={money(summary?.total_disbursed)} icon={Banknote} />
        <StatCard label="Cancellation Fees Retained" value={money(summary?.cancellation_fees_retained)} icon={RotateCcw} />
        <StatCard label="Pending Withdrawals" value={money(summary?.pending_withdrawal_amount)} sub={`${summary?.pending_withdrawal_count ?? 0} requests`} icon={Clock3} />
      </div>

      <Tabs
        tabs={[
          { id: "withdrawals", label: "Withdrawal Queue", count: pendingWithdrawals.length },
          { id: "refunds", label: "Refund Queue", count: pendingRefunds.length },
        ]}
        active={tab}
        onChange={(id) => setTab(id as "withdrawals" | "refunds")}
      />

      <div className="card" style={{ marginTop: 16 }}>
        {loading ? (
          <div className="table-loading">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="table-skeleton-row">
                <div className="skeleton" style={{ flex: 2, height: "13px" }} />
                <div className="skeleton" style={{ width: "80px", height: "13px" }} />
                <div className="skeleton" style={{ width: "70px", height: "22px", borderRadius: "20px" }} />
              </div>
            ))}
          </div>
        ) : tab === "withdrawals" ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Venue</th><th>Amount</th><th>Method</th><th>Requested</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {withdrawals.length === 0 ? (
                  <tr><td colSpan={6} className="data-table-empty">No withdrawal requests yet.</td></tr>
                ) : withdrawals.map((request) => (
                  <tr key={request.id}>
                    <td>{request.venue_name}<br /><small>{request.requested_by_name}</small></td>
                    <td>{money(request.amount)} {amountTierBadge(request.amount, summary)}</td>
                    <td>{request.payout_details?.account_name} · {request.payout_details?.account_number}<br /><small>{request.payout_method.replace("_", " ")}</small></td>
                    <td>{formatDate(request.created_at)}</td>
                    <td><Badge status={request.status === "completed" ? "active" : request.status} /></td>
                    <td>
                      {request.status === "pending" && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="button button-accent" type="button" disabled={busyId === request.id}
                            onClick={() => runAction(request.id, () => approveWithdrawal(request.id))}>Approve</button>
                          <button className="button button-ghost" type="button" disabled={busyId === request.id}
                            onClick={() => setRejecting(request)}>Reject</button>
                        </div>
                      )}
                      {request.status === "approved" && (
                        <button className="button button-accent" type="button" disabled={busyId === request.id}
                          onClick={() => runAction(request.id, () => completeWithdrawal(request.id, "Sent manually by admin"))}>
                          Mark sent
                        </button>
                      )}
                      {request.status === "rejected" && request.rejection_note ? <small>{request.rejection_note}</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Booking</th><th>Player</th><th>Venue</th><th>Refund</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {refunds.length === 0 ? (
                  <tr><td colSpan={6} className="data-table-empty">No refunds recorded yet.</td></tr>
                ) : refunds.map((refund) => (
                  <tr key={refund.id}>
                    <td>{refund.reference || refund.booking_id.slice(0, 8)}</td>
                    <td>{refund.player_name}</td>
                    <td>{refund.venue_name}</td>
                    <td>{money(refund.refund_amount)} <small>of {money(refund.total_collected)}</small></td>
                    <td><Badge status={refund.status === "refunded" ? "active" : refund.status === "failed" ? "rejected" : "pending"} /></td>
                    <td>
                      {(refund.status === "pending" || refund.status === "failed") && (
                        <button className="button button-accent" type="button" disabled={busyId === refund.id}
                          onClick={() => runAction(refund.id, () => retryRefund(refund.booking_id))}>
                          {refund.status === "failed" ? "Retry refund" : "Process refund"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(rejecting)}
        title="Reject withdrawal request"
        message={`This returns ${rejecting ? money(rejecting.amount) : ""} back to ${rejecting?.venue_name ?? "the venue"}'s available balance.`}
        confirmLabel="Reject"
        danger
        onConfirm={() => {
          if (!rejecting) return;
          const target = rejecting;
          setRejecting(null);
          void runAction(target.id, () => rejectWithdrawal(target.id, "Rejected by admin"));
        }}
        onCancel={() => setRejecting(null)}
      />
    </div>
  );
}
