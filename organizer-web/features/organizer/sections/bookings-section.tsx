"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Banknote, CalendarCheck, Clock3, Search, Wallet, CreditCard, Landmark, Smartphone } from "lucide-react";

const GCashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="24" rx="12" fill="#005CFF"/>
    <path d="M12.5 16.5C10.0147 16.5 8 14.4853 8 12C8 9.51472 10.0147 7.5 12.5 7.5C14.4372 7.5 16.0886 8.72371 16.7324 10.4167H14.5422C14.0415 9.61053 13.3292 9.16667 12.5 9.16667C10.9352 9.16667 9.66667 10.4352 9.66667 12C9.66667 13.5648 10.9352 14.8333 12.5 14.8333C13.5042 14.8333 14.3857 14.3093 14.847 13.5H12.5V11.8333H16.8333V12.1667C16.8333 14.5599 14.8932 16.5 12.5 16.5Z" fill="white"/>
  </svg>
);
import type { Booking, OrganizerData, Venue } from "@/lib/types";
import { Empty, Metric, SectionTitle, Status, dateOnly, money } from "../components/portal-ui";

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  gcash: "GCash",
  paymaya: "Maya",
  card: "Card",
  dob: "Online banking",
};

function paymentMethodLabel(booking: Booking) {
  const method = booking.payment_method;
  let label = "—";

  if (booking.payment_status === "pay_at_venue") label = "Pay at venue";
  else if (method) label = PAYMENT_METHOD_LABELS[method] || method;
  else if (booking.payment_status === "awaiting_payment") label = "Not paid yet";

  if (method === "gcash") return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><GCashIcon /> {label}</span>;
  if (method === "card") return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><CreditCard size={14} /> {label}</span>;
  if (method === "dob") return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Landmark size={14} /> {label}</span>;
  if (method === "paymaya") return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Smartphone size={14} /> {label}</span>;

  return label;
}

function timeRange(startsAt: string, endsAt: string) {
  const format = (value: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
  return `${format(startsAt)} – ${format(endsAt)}`;
}

export function BookingsSection({ data, venue, resourceId }: { data: OrganizerData; venue: Venue | null; resourceId?: string }) {
  const bookings = data.bookings;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [now] = useState(() => Date.now());

  if (!venue) return <div className="card venue-onboarding"><p>Add a venue to start tracking bookings.</p></div>;

  if (resourceId) {
    const booking = bookings.find((item) => item.id === resourceId);
    if (!booking) return <Empty title="Booking not found" detail="This booking may have been removed or belongs to another venue." />;
    return (
      <div className="management-grid">
        <div className="card management-card" style={{ padding: '32px' }}>
          <div className="booking-header">
            <div className="booking-header-top">
              <span className="card-kicker">{booking.reference || booking.id.slice(0, 8)}</span>
              <div className="booking-header-status">
                <Status value={booking.status} />
              </div>
            </div>
            <h2>{booking.court_name || "Court"}</h2>
            <p className="booking-subtitle">
              <span className="player-badge">{booking.player_name || "Peakle player"}</span>
              <span className="booking-datetime">{dateOnly(booking.starts_at)} • {timeRange(booking.starts_at, booking.ends_at)}</span>
            </p>
          </div>

          <div className="booking-details-grid">
            <div className="detail-section">
              <h3 className="section-eyebrow">Payment Information</h3>
              <div className="detail-rows">
                <div className="detail-row"><span className="detail-label">Payment status</span><span className="detail-value"><Status value={booking.payment_status} /></span></div>
                <div className="detail-row"><span className="detail-label">Payment method</span><span className="detail-value">{paymentMethodLabel(booking)}</span></div>
                <div className="detail-row"><span className="detail-label">Amount</span><span className="detail-value highlight-amount">{money(booking.amount)}</span></div>
              </div>
            </div>

            <div className="detail-section">
              <h3 className="section-eyebrow">Reservation Details</h3>
              <div className="detail-rows">
                <div className="detail-row"><span className="detail-label">Court</span><span className="detail-value">{booking.court_name || "—"}</span></div>
                <div className="detail-row"><span className="detail-label">Player</span><span className="detail-value">{booking.player_name || "Peakle player"}</span></div>
                <div className="detail-row"><span className="detail-label">Reference</span><span className="detail-value">{booking.reference || booking.id.slice(0, 8)}</span></div>
                <div className="detail-row"><span className="detail-label">Booked on</span><span className="detail-value">{dateOnly(booking.created_at)}</span></div>
              </div>
            </div>
          </div>
          <Link className="button button-ghost inline-action" href="/bookings">Back to bookings</Link>
        </div>
      </div>
    );
  }

  const upcoming = bookings.filter((booking) => new Date(booking.starts_at).getTime() > now && booking.status !== "cancelled");
  const awaitingPayment = bookings.filter((booking) => booking.payment_status === "awaiting_payment");
  const totalCollected = bookings.filter((booking) => booking.payment_status === "paid").reduce((sum, booking) => sum + Number(booking.amount || 0), 0);
  const needle = query.trim().toLowerCase();
  const visibleBookings = needle
    ? bookings.filter((booking) => (booking.player_name || "").toLowerCase().includes(needle) || (booking.reference || "").toLowerCase().includes(needle))
    : bookings;

  return (
    <div className="section-content">
      <div className="section-command-bar">
        <div><span className="command-icon"><CalendarCheck size={18} /></span><div><strong>{venue.name}</strong><small>Every reservation made at this venue</small></div></div>
      </div>
      <div className="analytics-grid">
        <Metric icon={CalendarCheck} value={String(bookings.length)} label="TOTAL BOOKINGS" />
        <Metric icon={Clock3} value={String(upcoming.length)} label="UPCOMING" />
        <Metric icon={Wallet} value={String(awaitingPayment.length)} label="AWAITING PAYMENT" />
        <Metric icon={Banknote} value={money(totalCollected)} label="COLLECTED (PAID BOOKINGS)" />
      </div>
      <SectionTitle eyebrow="RESERVATIONS" title="All bookings" />
      <div className="toolbar"><div className="search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by player name or booking code" aria-label="Search bookings" /></div></div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead><tr><th>COURT</th><th>PLAYER</th><th>DATE</th><th>TIME</th><th>AMOUNT</th><th>BOOKING</th><th>PAYMENT</th></tr></thead>
          <tbody>
            {visibleBookings.length ? visibleBookings.map((booking) => <tr key={booking.id} className="row-link" role="button" tabIndex={0} onClick={() => router.push(`/bookings/${booking.id}`)} onKeyDown={(event) => { if (event.key === "Enter") router.push(`/bookings/${booking.id}`); }}>
              <td>{booking.court_name || "Court"}{booking.reference ? <><br /><small style={{ color: 'var(--ink-40)' }}>{booking.reference}</small></> : null}</td>
              <td>{booking.player_name || "Peakle player"}</td>
              <td>{dateOnly(booking.starts_at)}</td>
              <td>{timeRange(booking.starts_at, booking.ends_at)}</td>
              <td>{money(booking.amount)}</td>
              <td><Status value={booking.status} /></td>
              <td><Status value={booking.payment_status} /></td>
            </tr>) : <tr><td colSpan={7}>{bookings.length ? "No bookings match your search." : "No bookings yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
