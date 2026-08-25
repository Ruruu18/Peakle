"use client";

import { Banknote, Clock3, TrendingUp, Wallet, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { OrganizerData, Venue } from "@/lib/types";
import { Empty, SectionTitle, SelectControl, Metric, dateOnly, money } from "../components/portal-ui";

const PAYOUT_METHODS = [
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "bank_transfer", label: "Bank transfer" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  requested: "Requested",
  processing: "Processing",
  paid: "Paid",
};

export function EarningsSection({ data, venue }: { data: OrganizerData; venue: Venue | null }) {
  const earnings = data.earnings;
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!venue) return <Empty title="No venue selected" detail="Add a venue to start tracking earnings." />;
  if (!earnings) return <Empty title="No earnings yet" detail="Earnings appear here after a booking or membership is paid." />;

  const canRequest = earnings.available_balance >= earnings.min_withdrawal_amount;

  return <>
    <div className="earnings-summary-head">
      <div><p className="eyebrow">PAYOUT SUMMARY</p><h2>Balance overview</h2><p>Balances update as paid transactions are settled.</p></div>
      <div className="earnings-command-actions">
        <button className="button button-accent" type="button" disabled={!canRequest} onClick={() => setDialogOpen(true)}>Request withdrawal</button>
        {!canRequest ? <small className="earnings-withdrawal-hint">Minimum balance: {money(earnings.min_withdrawal_amount)}</small> : null}
      </div>
    </div>
    <div className="analytics-grid">
      <Metric icon={Wallet} value={money(earnings.available_balance)} label="AVAILABLE BALANCE" />
      <Metric icon={Clock3} value={money(earnings.pending_withdrawal)} label="PENDING WITHDRAWAL" />
      <Metric icon={TrendingUp} value={money(earnings.total_earned)} label="TOTAL EARNED (ALL TIME)" />
      <Metric icon={Banknote} value={String(earnings.total_transactions ?? earnings.total_bookings)} label="PAID TRANSACTIONS" />
    </div>
    <SectionTitle eyebrow="LEDGER" title="Earnings history" />
    <div className="card" style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead><tr><th>DATE</th><th>REFERENCE</th><th>TYPE</th><th>PLAYER PAID</th><th>YOUR EARNINGS</th><th>STATUS</th></tr></thead>
        <tbody>
          {earnings.history.length ? earnings.history.map((row) => <tr key={row.id}>
            <td>{dateOnly(row.created_at)}</td>
            <td>{row.reference || row.id.slice(0, 8)}</td>
            <td>{row.source_type === "membership" ? row.description || "Membership" : row.description || "Court booking"}</td>
            <td>{money(row.total_collected)}</td>
            <td>{money(row.venue_amount)}{row.outcome === "cancelled" ? " (cancelled)" : ""}</td>
            <td><span className={`status ${row.status}`}>{STATUS_LABEL[row.status] || row.status}</span></td>
          </tr>) : <tr><td colSpan={6}>No paid transactions yet.</td></tr>}
        </tbody>
      </table>
    </div>
    {dialogOpen ? <RequestWithdrawalDialog venue={venue} balance={earnings.available_balance} onClose={() => setDialogOpen(false)} /> : null}
  </>;
}

function RequestWithdrawalDialog({ venue, balance, onClose }: { venue: Venue; balance: number; onClose: () => void }) {
  const [method, setMethod] = useState("gcash");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const accountName = String(values.get("account_name") || "").trim();
    const accountNumber = String(values.get("account_number") || "").trim();
    const bankCode = String(values.get("bank_code") || "").trim();
    if (!accountName || !accountNumber) { toast.error("Account name and number are required."); return; }
    setBusy(true);
    try {
      const payoutDetails: Record<string, string> = { account_name: accountName, account_number: accountNumber };
      if (method === "bank_transfer" && bankCode) payoutDetails.bank_code = bankCode;
      const { error } = await requireSupabase().rpc("request_withdrawal", {
        p_venue_id: venue.id,
        p_payout_method: method,
        p_payout_details: payoutDetails,
      });
      if (error) throw error;
      toast.success("Withdrawal requested. Peakle will review and send your payout.");
      onClose();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Withdrawal request failed."); }
    finally { setBusy(false); }
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="withdrawal-dialog-title">
      <div className="dialog-head"><div><p className="eyebrow">REQUEST PAYOUT</p><h2 id="withdrawal-dialog-title">Withdraw {money(balance)}</h2><p>Your full available balance is requested — Peakle sends it via GCash, Maya, or bank transfer.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <form onSubmit={submit}>
        <div className="form-field"><label>PAYOUT METHOD</label><SelectControl value={method} onChange={setMethod} ariaLabel="Payout method" options={PAYOUT_METHODS} /></div>
        <div className="form-field"><label htmlFor="account-name">ACCOUNT NAME</label><input id="account-name" name="account_name" minLength={2} maxLength={120} required /></div>
        <div className="form-field"><label htmlFor="account-number">{method === "bank_transfer" ? "ACCOUNT NUMBER" : "MOBILE NUMBER"}</label><input id="account-number" name="account_number" minLength={4} maxLength={40} required /></div>
        {method === "bank_transfer" ? <div className="form-field"><label htmlFor="bank-code">BANK</label><input id="bank-code" name="bank_code" placeholder="e.g. BDO" maxLength={40} /></div> : null}
        <div className="dialog-actions"><button className="button button-ghost" type="button" onClick={onClose}>Cancel</button><button className="button button-accent" type="submit" disabled={busy}>{busy ? "Requesting…" : "Request withdrawal"}</button></div>
      </form>
    </div>
  </div>;
}
