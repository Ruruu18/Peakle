"use client";

import Link from "next/link";
import { CalendarDays, CircleDollarSign, Clock3 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers";
import { requireSupabase } from "@/lib/supabase";
import type { Venue } from "@/lib/types";
import { manilaDateTime, ScheduleControl, TimeControl } from "../components/schedule-control";
import { SectionTitle, SelectControl, SettingRow, Status, money } from "../components/portal-ui";
import { CreateCourtDialog, CreateVenueDialog } from "../dialogs/venue-dialogs";

export function VenuesSection({ venue, refresh, subview }: { venue: Venue | null; refresh: () => Promise<void>; subview?: string }) {
  const [dialog, setDialog] = useState<"venue" | "court" | null>(null);
  if (!venue) return <><div className="venue-onboarding card"><div><p className="eyebrow">GET STARTED</p><h2>Build your venue workspace</h2><p>Add the location your players visit, then create its courts, rates, and operating schedule.</p><button className="button button-accent" type="button" onClick={() => setDialog("venue")}>Add your first venue</button></div><div className="onboarding-steps"><span>01<strong>Venue details</strong></span><span>02<strong>Court inventory</strong></span><span>03<strong>Publish activities</strong></span></div></div>{dialog === "venue" ? <CreateVenueDialog onClose={() => setDialog(null)} onCreated={async () => { setDialog(null); await refresh(); }} /> : null}</>;
  if (subview) return <VenueManagement venue={venue} subview={subview} refresh={refresh} />;
  const toggleCourt = async (courtId: string, active: boolean) => {
    try {
      const { error } = await requireSupabase().from("courts").update({ active }).eq("id", courtId);
      if (error) throw error;
      await refresh();
      toast.success(active ? "Court is available to players." : "Court hidden from booking.");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Court update failed."); }
  };
  return <>
    <div className="section-command-bar"><div><span className="command-icon">{venue.name.slice(0, 1).toUpperCase()}</span><div><strong>Venue operations</strong><small>Manage this location and its court inventory</small></div></div><div><button className="button button-ghost" type="button" onClick={() => setDialog("venue")}>Add venue</button><button className="button button-accent" type="button" onClick={() => setDialog("court")}>Add court</button></div></div>
    <div className="card venue-hero"><div><Status value={venue.verification_status || "pending"} /><h2>{venue.name}</h2><p>{venue.address || venue.area} · {venue.venue_type || "Pickleball venue"}</p></div><div className="venue-facts"><div><strong>{venue.courts.filter((court) => court.active).length}</strong><small>ACTIVE COURTS</small></div><div><strong>{venue.opens_at?.slice(0, 5) || "—"}</strong><small>OPENS</small></div><div><strong>{venue.closes_at?.slice(0, 5) || "—"}</strong><small>CLOSES</small></div></div></div>
    <SectionTitle eyebrow="COURT INVENTORY" title={`${venue.courts.length} courts`} />
    <div className="venue-court-list">{venue.courts.map((court, index) => <div className="card venue-court-row" key={court.id}><span>{index + 1}</span><div><strong>{court.name}</strong><small>{court.environment || venue.venue_type} · {court.surface || "Standard surface"} · {money(court.hourly_price)}/hr</small></div><button className={`switch ${court.active ? "on" : ""}`} type="button" role="switch" aria-checked={Boolean(court.active)} aria-label={`${court.active ? "Disable" : "Enable"} ${court.name}`} onClick={() => toggleCourt(court.id, !court.active)}><span /></button></div>)}</div>
    <SectionTitle eyebrow="BOOKING CONTROL" title="Pricing and availability" />
    <div className="card setting-list"><SettingRow icon={CircleDollarSign} title="Pricing rules" detail="Standard, peak, weekend, and promotional rates" action="Manage" href="/venues/pricing" /><SettingRow icon={CalendarDays} title="Court blackouts" detail="Maintenance, events, and private reservations" action="Manage" href="/venues/blackouts" /><SettingRow icon={Clock3} title="Operating schedule" detail={`${venue.opens_at?.slice(0, 5) || "—"} to ${venue.closes_at?.slice(0, 5) || "—"} standard hours`} action="Edit" href="/venues/schedule" /></div>
    {dialog === "venue" ? <CreateVenueDialog onClose={() => setDialog(null)} onCreated={async () => { setDialog(null); await refresh(); }} /> : null}
    {dialog === "court" ? <CreateCourtDialog venue={venue} onClose={() => setDialog(null)} onCreated={async () => { setDialog(null); await refresh(); }} /> : null}
  </>;
}

function VenueManagement({ venue, subview, refresh }: { venue: Venue; subview: string; refresh: () => Promise<void> }) {
  const title = subview === "pricing" ? "Court pricing" : subview === "blackouts" ? "Court blackouts" : "Operating schedule";
  const [opensAt, setOpensAt] = useState(venue.opens_at?.slice(0, 5) || "06:00");
  const [closesAt, setClosesAt] = useState(venue.closes_at?.slice(0, 5) || "22:00");
  const savePricing = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      const client = requireSupabase();
      const results = await Promise.all(venue.courts.map((court) => client.from("courts").update({ hourly_price: Number(values.get(`price-${court.id}`)) }).eq("id", court.id)));
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      await refresh();
      toast.success("Court pricing saved.");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Pricing update failed."); }
  };
  const saveSchedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const { error } = await requireSupabase().from("venues").update({ opens_at: opensAt, closes_at: closesAt }).eq("id", venue.id);
      if (error) throw error;
      await refresh();
      toast.success("Operating schedule saved.");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Schedule update failed."); }
  };
  return <div className="management-grid"><div className="card management-card"><div className="card-topline"><span className="card-kicker">VENUE CONTROL</span><Link className="text-action" href="/venues">BACK →</Link></div><h2>{title}</h2><p>{venue.name}</p>{subview === "pricing" ? <form onSubmit={savePricing}><div className="venue-court-list">{venue.courts.map((court) => <div className="venue-court-row" key={court.id}><span>₱</span><div><strong>{court.name}</strong><small>Hourly booking price</small></div><input className="price-input" name={`price-${court.id}`} type="number" min="0" step="1" defaultValue={court.hourly_price || 0} aria-label={`${court.name} hourly price`} /></div>)}</div><button className="button button-accent" type="submit">Save pricing</button></form> : subview === "blackouts" ? <BlackoutForm venue={venue} /> : <form className="management-form" onSubmit={saveSchedule}><div className="form-field"><label>OPENS</label><TimeControl value={opensAt} onChange={setOpensAt} ariaLabel="Venue opening time" /></div><div className="form-field"><label>CLOSES</label><TimeControl value={closesAt} onChange={setClosesAt} ariaLabel="Venue closing time" /></div><button className="button button-accent" type="submit">Save schedule</button></form>}</div></div>;
}

function BlackoutForm({ venue }: { venue: Venue }) {
  const { user } = useAuth();
  const [courtId, setCourtId] = useState("");
  const [kind, setKind] = useState("maintenance");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const form = event.currentTarget;
    const start = manilaDateTime(startsAt);
    const end = manilaDateTime(endsAt);
    if (start <= new Date()) { toast.error("Blackout start time must be in the future."); return; }
    if (end <= start) { toast.error("Blackout end time must be after its start time."); return; }
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      const { error } = await requireSupabase().from("court_blackouts").insert({ venue_id: venue.id, court_id: courtId || null, kind, reason: String(values.get("reason") || "").trim(), starts_at: start.toISOString(), ends_at: end.toISOString(), created_by: user.id });
      if (error) throw error;
      form.reset();
      setStartsAt("");
      setEndsAt("");
      toast.success("Court blackout created.");
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Blackout creation failed."); }
    finally { setBusy(false); }
  };
  return <form className="management-form" onSubmit={submit}><div className="form-field"><label>COURT</label><SelectControl value={courtId} onChange={setCourtId} ariaLabel="Blackout court" options={[{ value: "", label: "All courts" }, ...venue.courts.map((court) => ({ value: court.id, label: court.name }))]} /></div><div className="form-field"><label>TYPE</label><SelectControl value={kind} onChange={setKind} ariaLabel="Blackout type" options={[{ value: "maintenance", label: "Maintenance" }, { value: "private_event", label: "Private event" }, { value: "closure", label: "Venue closure" }]} /></div><div className="form-field full"><label>START</label><ScheduleControl value={startsAt} onChange={setStartsAt} ariaLabel="Blackout start" /></div><div className="form-field full"><label>END</label><ScheduleControl value={endsAt} onChange={setEndsAt} ariaLabel="Blackout end" /></div><div className="form-field full"><label htmlFor="blackout-reason">REASON</label><input id="blackout-reason" name="reason" minLength={2} maxLength={160} required /></div><button className="button button-accent" type="submit" disabled={busy || !startsAt || !endsAt}>{busy ? "Creating…" : "Create blackout"}</button></form>;
}
