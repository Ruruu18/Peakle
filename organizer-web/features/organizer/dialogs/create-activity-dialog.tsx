"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { MembershipProduct, Program, Venue } from "@/lib/types";
import { manilaDateTime, manilaToday, ScheduleControl } from "../components/schedule-control";
import { SelectControl, titleCase } from "../components/portal-ui";
import { CreateOpenPlayDialog } from "./create-open-play-dialog";

export type CreateType = "session" | "program" | "competition" | "membership";

type CreateDialogProps = { type: CreateType; venue: Venue | null; userId: string; onClose: () => void; onCreated: () => void };

export function CreateDialog(props: CreateDialogProps) {
  if (props.type === "session") return <CreateOpenPlayDialog venue={props.venue} userId={props.userId} onClose={props.onClose} onCreated={props.onCreated} />;
  return <GenericCreateDialog {...props} />;
}

function GenericCreateDialog({ type, venue, userId, onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [capacity, setCapacity] = useState("16");
  const [price, setPrice] = useState("0");
  const [kind, setKind] = useState(type === "program" ? "clinic" : type === "competition" ? "tournament" : type === "membership" ? "membership" : "doubles");
  const [busy, setBusy] = useState(false);
  const label = { session: "open play", program: "program", competition: "competition", membership: "membership" }[type];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!venue) { toast.error("Add or select a verified venue first."); return; }
    if (type === "competition" && schedule < manilaToday()) { toast.error("Competition dates cannot be in the past."); return; }
    if (type !== "competition" && type !== "membership" && (!schedule || manilaDateTime(schedule) <= new Date())) { toast.error("Choose a start time in the future."); return; }
    setBusy(true);
    try {
      const client = requireSupabase();
      if (type === "session") {
        const courtIds = venue.courts.filter((court) => court.active).slice(0, Math.max(1, Math.min(2, venue.courts.length))).map((court) => court.id);
        const start = manilaDateTime(schedule);
        const end = new Date(start.getTime() + 3 * 3600000);
        const { error } = await client.rpc("create_open_play_session", { p_name: name.trim(), p_venue_id: venue.id, p_court_ids: courtIds, p_capacity: Number(capacity), p_visibility: "public", p_approval_mode: "manual", p_skill_min: null, p_skill_max: null, p_fee_amount: Number(price), p_scheduled_start: start.toISOString(), p_scheduled_end: end.toISOString(), p_rules: null, p_cancellation_policy: null, p_match_format: kind, p_court_formats: courtIds.map(() => kind), p_average_match_minutes: 15, p_max_consecutive_games: 2, p_rest_minutes: 0 });
        if (error) throw error;
      } else if (type === "program") {
        const start = manilaDateTime(schedule);
        const { error } = await client.from("venue_programs").insert({ venue_id: venue.id, created_by: userId, name: name.trim(), kind, skill_division: "all", starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 2 * 3600000).toISOString(), capacity: Number(capacity), price: Number(price), registration_status: "open" }).select().single<Program>();
        if (error) throw error;
      } else if (type === "competition") {
        const { error } = await client.rpc("create_competition_with_divisions", { p_venue_id: venue.id, p_name: name.trim(), p_kind: kind, p_starts_on: new Date(schedule).toISOString().slice(0, 10), p_ends_on: null, p_rules: null, p_visibility: "public", p_divisions: [{ name: "Open Doubles", format: "doubles", participantDivision: "open", skillCategory: "open", entryType: "team", capacity: Number(capacity), feeAmount: Number(price), feeBasis: "team" }] });
        if (error) throw error;
      } else {
        const { error } = await client.from("membership_products").insert({ venue_id: venue.id, name: name.trim(), kind, price: Number(price), credits: Number(capacity), discount_percent: 0, validity_days: 30 }).select().single<MembershipProduct>();
        if (error) throw error;
      }
      toast.success(`${titleCase(label)} created.`);
      onCreated();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : `The ${label} could not be created.`);
    } finally { setBusy(false); }
  };

  const kindOptions = type === "session"
    ? [{ value: "doubles", label: "Doubles" }, { value: "singles", label: "Singles" }, { value: "mixed", label: "Mixed courts" }]
    : type === "program"
      ? [{ value: "clinic", label: "Clinic" }, { value: "coaching", label: "Coaching" }, { value: "camp", label: "Camp" }]
      : type === "competition"
        ? [{ value: "tournament", label: "Tournament" }, { value: "league", label: "League" }, { value: "ladder", label: "Ladder" }]
        : [{ value: "membership", label: "Membership" }, { value: "court_pack", label: "Court pack" }, { value: "session_pack", label: "Session pack" }];

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`dialog dialog-activity ${type === "membership" ? "compact" : ""}`} role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="dialog-head"><div><p className="eyebrow">NEW {label.toUpperCase()}</p><h2 id="create-title">Create {label}</h2><p>{venue?.name || "Select a venue to continue"}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><form onSubmit={submit}><div className="activity-dialog-layout"><div className="activity-form-panel"><div className="form-field"><label htmlFor="create-name">NAME</label><input id="create-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={type === "session" ? "e.g. Friday Night Open Play" : `Enter ${label} name`} required minLength={2} autoFocus /></div><div className="form-field"><label htmlFor="create-kind">TYPE</label><SelectControl id="create-kind" className="form-select" value={kind} onChange={setKind} ariaLabel={`${titleCase(label)} type`} options={kindOptions} /></div><div className="activity-number-grid"><div className="form-field"><label htmlFor="create-capacity">{type === "membership" ? "CREDITS" : "CAPACITY"}</label><input id="create-capacity" type="number" inputMode="numeric" min="1" max="500" value={capacity} onChange={(event) => setCapacity(event.target.value)} required /></div><div className="form-field"><label htmlFor="create-price">PRICE · PHP</label><input id="create-price" type="number" inputMode="decimal" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} required /></div></div></div>{type !== "membership" ? <div className="activity-schedule-panel"><div className="activity-panel-head"><span>02</span><div><strong>{type === "competition" ? "Competition date" : "Schedule"}</strong><small>Select it here without leaving the form.</small></div></div><ScheduleControl inline value={schedule} onChange={setSchedule} ariaLabel={`${titleCase(label)} start`} dateOnly={type === "competition"} /></div> : null}</div><div className="dialog-actions"><span className="dialog-hint">All times use the venue’s local timezone.</span><button className="button button-ghost" type="button" onClick={onClose}>Cancel</button><button className="button button-accent" disabled={busy || !venue || (type !== "membership" && !schedule)} type="submit">{busy ? "Publishing…" : `Publish ${label}`}<Check size={16} /></button></div></form></div></div>;
}
