"use client";

import { Activity, CalendarDays, CircleDollarSign, RefreshCw, TicketCheck, Users, X } from "lucide-react";
import type { OrganizerData } from "@/lib/types";
import { Metric, SectionTitle, dateOnly, money } from "../components/portal-ui";

export function AnalyticsSection({ data }: { data: OrganizerData }) {
  const analytics = data.analytics || {};
  const chart = analytics.dailyUtilization || [];
  return <>
    <div className="analytics-grid"><Metric icon={CircleDollarSign} value={money(analytics.grossRevenue)} label="GROSS REVENUE" trend="30 days" /><Metric icon={CalendarDays} value={String(analytics.bookings || 0)} label="BOOKINGS" trend="30 days" /><Metric icon={Users} value={String(analytics.uniquePlayers || 0)} label="UNIQUE PLAYERS" trend={`${analytics.returningPlayers || 0} returned`} /><Metric icon={Activity} value={`${analytics.courtUtilization || 0}%`} label="COURT UTILIZATION" trend={analytics.peakHour || "—"} /></div>
    <SectionTitle eyebrow="LAST 30 DAYS" title="Venue performance" />
    <div className="analytics-grid">
      <div className="card chart-card wide"><div className="chart-head"><div><p className="eyebrow">COURT UTILIZATION</p><h3>Demand by day</h3></div><span className="status active">{analytics.courtUtilization || 0}% avg</span></div>{chart.some(day => day.utilization > 0) ? <div className="bar-chart">{chart.map((day, index) => <div key={day.date} className={`bar ${index === chart.length - 1 ? "active" : ""}`} style={{ height: `${Math.max(2, Math.min(100, day.utilization))}%` }} title={`${dateOnly(day.date)}: ${day.utilization}%`}><span>{new Intl.DateTimeFormat("en-PH", { weekday: "narrow", timeZone: "Asia/Manila" }).format(new Date(`${day.date}T00:00:00+08:00`))}</span></div>)}</div> : <p className="chart-empty">No court bookings in the last seven days.</p>}</div>
      <div className="card chart-card wide"><div className="chart-head"><div><p className="eyebrow">CAPACITY</p><h3>Utilization snapshot</h3></div></div><div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(var(--optic) 0 ${Math.max(0, Math.min(100, analytics.courtUtilization || 0))}%, var(--teal-wash) 0 100%)` }} /><div className="donut-copy"><strong>{analytics.courtUtilization || 0}%</strong><span>COURTS USED</span></div></div></div>
    </div>
    <SectionTitle eyebrow="PLAYER HEALTH" title="Attendance and retention" />
    <div className="metric-grid"><Metric icon={Users} value={String(analytics.openPlayAttendance || 0)} label="OPEN-PLAY VISITS" /><Metric icon={RefreshCw} value={String(analytics.returningPlayers || 0)} label="RETURNING PLAYERS" /><Metric icon={TicketCheck} value={String(analytics.programRegistrations || 0)} label="PROGRAM REGISTRATIONS" /><Metric icon={X} value={`${analytics.cancellationRate || 0}%`} label="CANCELLATION RATE" /></div>
  </>;
}
