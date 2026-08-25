"use client";

import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, ChevronUp, Clock3, Grid2X2, MapPin, RotateCw, Sparkles, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { requireSupabase } from "@/lib/supabase";
import type { Venue } from "@/lib/types";
import { manilaToday, minimumFutureManilaTime, ScheduleControl, TimeControl } from "../components/schedule-control";

const pad = (value: number) => String(value).padStart(2, "0");
const defaultSchedule = () => {
  const next = new Date(Date.now() + 8 * 60 * 60 * 1000);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  if (next.getUTCHours() > 20) { next.setUTCDate(next.getUTCDate() + 1); next.setUTCHours(9); }
  const end = new Date(next.getTime() + 3 * 60 * 60 * 1000);
  return {
    date: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`,
    start: `${pad(next.getUTCHours())}:${pad(next.getUTCMinutes())}`,
    end: `${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`,
  };
};
const sessionTimes = (date: string, start: string, end: string) => {
  const startsAt = new Date(`${date}T${start}:00+08:00`);
  let endsAt = new Date(`${date}T${end}:00+08:00`);
  if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
};

type Availability = { court_id: string; available: boolean; reason?: string | null };
type Choice = { value: string; label: string; detail?: string };

function ChoiceCards({ value, onChange, options, columns = 3 }: { value: string; onChange: (value: string) => void; options: Choice[]; columns?: number }) {
  return <div className="open-play-choices" style={{ "--choice-columns": columns } as React.CSSProperties}>{options.map((option) => <button className={value === option.value ? "selected" : ""} type="button" role="radio" aria-checked={value === option.value} key={option.value} onClick={() => onChange(option.value)}><span>{value === option.value ? <Check size={13} /> : null}</span><span><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</span></button>)}</div>;
}

export function CreateOpenPlayDialog({ venue, userId, onClose, onCreated }: { venue: Venue | null; userId: string; onClose: () => void; onCreated: () => void }) {
  const defaults = useMemo(() => defaultSchedule(), []);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("Community open play");
  const [date, setDate] = useState(defaults.date);
  const [startTime, setStartTime] = useState(defaults.start);
  const [endTime, setEndTime] = useState(defaults.end);
  const [capacity, setCapacity] = useState("24");
  const [selectedCourtIds, setSelectedCourtIds] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [checkingCourts, setCheckingCourts] = useState(false);
  const [matchFormat, setMatchFormat] = useState("doubles");
  const [courtFormats, setCourtFormats] = useState<Record<string, "singles" | "doubles">>({});
  const [rotationPreset, setRotationPreset] = useState("balanced");
  const [averageMatchMinutes, setAverageMatchMinutes] = useState("15");
  const [maxConsecutiveGames, setMaxConsecutiveGames] = useState("2");
  const [restMinutes, setRestMinutes] = useState("0");
  const [visibility, setVisibility] = useState("public");
  const [approvalMode, setApprovalMode] = useState("automatic");
  const [skillCategory, setSkillCategory] = useState("open");
  const [fee, setFee] = useState("0");
  const [rules, setRules] = useState("Doubles · First to 11 · Win by 2");
  const [cancellationPolicy, setCancellationPolicy] = useState("Cancel before the session starts so a waitlisted player can take your place.");
  const [playerNames, setPlayerNames] = useState("");
  const [includeOrganizer, setIncludeOrganizer] = useState(true);
  const [customizingRules, setCustomizingRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const stepThreeEnteredAt = useRef(0);
  const activeCourts = useMemo(() => venue?.courts.filter((court) => court.active !== false) || [], [venue]);
  const { startsAt, endsAt } = useMemo(() => sessionTimes(date, startTime, endTime), [date, endTime, startTime]);
  const availabilityByCourt = useMemo(() => new Map(availability.map((item) => [item.court_id, item])), [availability]);
  const guestNames = useMemo(() => [...new Set(playerNames.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))], [playerNames]);

  useEffect(() => {
    let current = true;
    const loadAvailability = async () => {
      if (!venue || !activeCourts.length || startsAt <= new Date() || endsAt <= startsAt) {
        await Promise.resolve();
        if (current) { setAvailability([]); setSelectedCourtIds([]); }
        return;
      }
      setCheckingCourts(true);
      try {
        const { data, error } = await requireSupabase().rpc("get_court_availability", { p_court_ids: activeCourts.map((court) => court.id), p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString() });
        if (!current) return;
        if (error) throw error;
        const rows = (data || []) as Availability[];
        const allowed = new Set(rows.filter((item) => item.available).map((item) => item.court_id));
        setAvailability(rows);
        setSelectedCourtIds((selected) => {
          const stillAvailable = selected.filter((id) => allowed.has(id));
          return stillAvailable.length ? stillAvailable : activeCourts.filter((court) => allowed.has(court.id)).slice(0, 2).map((court) => court.id);
        });
      } catch (reason) {
        if (current) { setAvailability([]); setSelectedCourtIds([]); toast.error(reason instanceof Error ? reason.message : "Court availability could not be checked."); }
      } finally { if (current) setCheckingCourts(false); }
    };
    void loadAvailability();
    return () => { current = false; };
  }, [activeCourts, endsAt, startsAt, venue]);

  const chooseRotation = (value: string) => {
    setRotationPreset(value);
    if (value === "balanced") { setAverageMatchMinutes("15"); setMaxConsecutiveGames("2"); setRestMinutes("0"); }
    if (value === "equal_turns") { setAverageMatchMinutes("15"); setMaxConsecutiveGames("1"); setRestMinutes("3"); }
  };
  const toggleCourt = (courtId: string) => setSelectedCourtIds((selected) => selected.includes(courtId) ? selected.filter((id) => id !== courtId) : [...selected, courtId]);
  const selectedFormats = selectedCourtIds.map((courtId, index) => matchFormat === "mixed" ? courtFormats[courtId] || (index % 2 ? "singles" : "doubles") : matchFormat as "singles" | "doubles");
  const capacityNumber = Number(capacity);
  const rotationValid = Number(averageMatchMinutes) >= 5 && Number(averageMatchMinutes) <= 90 && Number(maxConsecutiveGames) >= 0 && Number(maxConsecutiveGames) <= 10 && Number(restMinutes) >= 0 && Number(restMinutes) <= 120;
  const stepOneValid = Boolean(venue?.verification_status === "verified" && name.trim().length >= 3 && startsAt > new Date() && endsAt > startsAt && selectedCourtIds.length && capacityNumber >= 4 && capacityNumber <= 200 && !checkingCourts);
  const stepTwoValid = rotationValid && (matchFormat !== "mixed" || selectedCourtIds.length >= 2);
  const skillRange = skillCategory === "novice" ? [1, 2.5] : skillCategory === "intermediate" ? [2.5, 4] : skillCategory === "advanced" ? [4, 5.5] : [null, null];
  const stepThreeValid = Number.isFinite(Number(fee)) && Number(fee) >= 0 && guestNames.length + (includeOrganizer ? 1 : 0) <= capacityNumber && Boolean(rules.trim() && cancellationPolicy.trim());

  const publish = async () => {
    // A desktop double-click on "Continue to players" can land its second
    // click on the publish button that replaces it in the same position.
    if (Date.now() - stepThreeEnteredAt.current < 600) return;
    if (startsAt <= new Date()) { toast.error("Choose a start time in the future."); setStep(1); return; }
    if (!venue || !stepOneValid || !stepTwoValid) return;
    setBusy(true);
    try {
      const client = requireSupabase();
      const { data, error } = await client.rpc("create_open_play_session", {
        p_name: name.trim(), p_venue_id: venue.id, p_court_ids: selectedCourtIds, p_capacity: capacityNumber,
        p_visibility: visibility, p_approval_mode: approvalMode, p_skill_min: skillRange[0], p_skill_max: skillRange[1],
        p_fee_amount: Number(fee), p_scheduled_start: startsAt.toISOString(), p_scheduled_end: endsAt.toISOString(),
        p_rules: rules.trim(), p_cancellation_policy: cancellationPolicy.trim(), p_match_format: matchFormat,
        p_court_formats: selectedFormats, p_average_match_minutes: Number(averageMatchMinutes),
        p_max_consecutive_games: Number(maxConsecutiveGames), p_rest_minutes: Number(restMinutes),
      });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      if (created?.id && (includeOrganizer || guestNames.length)) {
        const checkedInAt = new Date().toISOString();
        const rows = [
          ...(includeOrganizer ? [{ id: crypto.randomUUID(), session_id: created.id, user_id: userId, guest_name: null }] : []),
          ...guestNames.map((guestName) => ({ id: crypto.randomUUID(), session_id: created.id, user_id: null, guest_name: guestName })),
        ].map((row, index) => ({ ...row, status: "waiting", registration_status: "approved", checked_in_at: checkedInAt, waiting_since: checkedInAt, queue_position: index, games_played: 0 }));
        const { error: playerError } = await client.from("open_play_players").insert(rows);
        if (playerError) toast.warning("Open play was published, but some pre-added players could not be checked in.");
      }
      toast.success("Open play published.");
      onCreated();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "The open play session could not be created."); }
    finally { setBusy(false); }
  };

  const titles = ["When and where?", "How should rotation work?", "Who can join?"];
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog dialog-open-play" role="dialog" aria-modal="true" aria-labelledby="open-play-title">
    <div className="dialog-head"><div><p className="eyebrow">OPEN PLAY SETUP · STEP {step} OF 3</p><h2 id="open-play-title">{titles[step - 1]}</h2><p>{step === 1 ? "Start with the details players need to find the session." : step === 2 ? "Choose a ready-made rotation or tune the controls." : "Set access, approval, and optional player requirements."}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
    <div className="open-play-progress" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map((item) => <span className={item <= step ? "active" : ""} key={item} />)}</div>
    <form onSubmit={(event) => event.preventDefault()}>
      {step === 1 ? <div className="open-play-step-grid"><section className="open-play-step-card"><div className="open-play-step-intro"><CalendarDays size={20} /><div><strong>Session details</strong><small>Name it and choose the Manila schedule.</small></div></div><div className="form-field"><label htmlFor="open-play-name">SESSION NAME</label><input id="open-play-name" value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={80} autoFocus required /></div><div className="form-field"><label>SESSION DATE</label><ScheduleControl value={date} onChange={setDate} ariaLabel="Session date" dateOnly /></div><div className="open-play-time-row"><div className="form-field"><label>START TIME</label><TimeControl value={startTime} onChange={setStartTime} ariaLabel="Start time" minValue={date === manilaToday() ? minimumFutureManilaTime(date) : undefined} /></div><div className="form-field"><label>END TIME</label><TimeControl value={endTime} onChange={setEndTime} ariaLabel="End time" /></div></div><div className="timezone-note"><Clock3 size={14} />Asia/Manila (UTC+8){endsAt.toDateString() !== startsAt.toDateString() ? " · ends next day" : ""}</div><div className="form-field"><label htmlFor="open-play-capacity">PLAYER CAPACITY</label><input id="open-play-capacity" type="number" inputMode="numeric" min="4" max="200" value={capacity} onChange={(event) => setCapacity(event.target.value)} required /></div></section>
        <section className="open-play-step-card"><div className="open-play-step-intro"><MapPin size={20} /><div><strong>{venue?.name || "No venue selected"}</strong><small>{venue?.area || venue?.address || "Choose a verified venue from the workspace."}</small></div></div><div className="court-selection-head"><label>COURTS FOR OPEN PLAY</label><span>{checkingCourts ? "CHECKING…" : `${availability.filter((item) => item.available).length} AVAILABLE`}</span></div><div className="open-play-courts">{activeCourts.map((court) => { const status = availabilityByCourt.get(court.id); const available = Boolean(status?.available); const selected = selectedCourtIds.includes(court.id); return <button className={`${selected ? "selected" : ""} ${!available ? "unavailable" : ""}`} type="button" role="checkbox" aria-checked={selected} disabled={!available || checkingCourts} key={court.id} onClick={() => toggleCourt(court.id)}><span>{selected ? <Check size={14} /> : <Grid2X2 size={14} />}</span><span><strong>{court.name}</strong><small>{checkingCourts ? "Checking schedule" : available ? "Available" : status?.reason || "Unavailable"}</small></span></button>; })}</div>{!activeCourts.length ? <div className="open-play-empty">This venue has no active courts. Add a court before publishing Open Play.</div> : null}<small className="field-help">{selectedCourtIds.length ? `${selectedCourtIds.length} court${selectedCourtIds.length === 1 ? "" : "s"} selected` : "Select at least one available court."}</small></section></div> : null}

      {step === 2 ? <div className="open-play-step-grid"><section className="open-play-step-card"><div className="open-play-step-intro"><RotateCw size={20} /><div><strong>Match format</strong><small>Use one format or divide formats by court.</small></div></div><ChoiceCards value={matchFormat} onChange={setMatchFormat} options={[{ value: "doubles", label: "Doubles" }, { value: "singles", label: "Singles" }, { value: "mixed", label: "Both" }]} />{matchFormat === "mixed" ? <div className="court-format-list"><p className="eyebrow" style={{ margin: "4px 0 8px", fontSize: 9 }}>TAP A COURT TO TOGGLE FORMAT</p>{selectedCourtIds.map((courtId, index) => { const court = activeCourts.find((item) => item.id === courtId); const format = courtFormats[courtId] || (index % 2 ? "singles" : "doubles"); return <button type="button" key={courtId} onClick={() => setCourtFormats((current) => ({ ...current, [courtId]: format === "singles" ? "doubles" : "singles" }))}><span>{index + 1}</span><strong>{court?.name}</strong><small>{format}</small></button>; })}</div> : null}</section>
        <section className="open-play-step-card"><div className="open-play-step-intro"><Sparkles size={20} /><div><strong>Rotation style</strong><small>These settings power fair queue recommendations.</small></div></div><ChoiceCards value={rotationPreset} onChange={chooseRotation} columns={1} options={[{ value: "balanced", label: "Balanced", detail: "Up to 2 games in a row · no forced rest" }, { value: "equal_turns", label: "Equal turns", detail: "1 game at a time · 3-minute rest" }, { value: "custom", label: "Custom controls", detail: "Set match length, games, and rest" }]} />{rotationPreset === "custom" ? <div className="rotation-input-grid"><div className="form-field"><label htmlFor="match-length">MATCH MINUTES</label><input id="match-length" type="number" min="5" max="90" value={averageMatchMinutes} onChange={(event) => setAverageMatchMinutes(event.target.value)} /></div><div className="form-field"><label htmlFor="consecutive-games">GAMES IN A ROW</label><input id="consecutive-games" type="number" min="0" max="10" value={maxConsecutiveGames} onChange={(event) => setMaxConsecutiveGames(event.target.value)} /></div><div className="form-field"><label htmlFor="rest-minutes">REST MINUTES</label><input id="rest-minutes" type="number" min="0" max="120" value={restMinutes} onChange={(event) => setRestMinutes(event.target.value)} /></div></div> : null}</section></div> : null}

      {step === 3 ? <div className="open-play-step-grid"><section className="open-play-step-card"><div className="open-play-step-intro"><Users size={20} /><div><strong>Who can join?</strong><small>Recommended defaults are already selected.</small></div></div><label className="open-play-group-label">SESSION ACCESS</label><ChoiceCards value={visibility} onChange={setVisibility} options={[{ value: "public", label: "Public" }, { value: "private", label: "Code only" }, { value: "invite_only", label: "Invite only" }]} /><label className="open-play-group-label">JOIN APPROVAL</label><small className="field-help">Automatic lets players join instantly. Review first holds each request for you to approve.</small><ChoiceCards value={approvalMode} onChange={setApprovalMode} columns={2} options={[{ value: "automatic", label: "Automatic" }, { value: "manual", label: "Review first" }]} /><label className="open-play-group-label">SKILL CATEGORY</label><small className="field-help">Only players rated in this range can join. Choose Open if you don&apos;t want to restrict by skill.</small><ChoiceCards value={skillCategory} onChange={setSkillCategory} columns={2} options={[{ value: "open", label: "Open", detail: "Any rating" }, { value: "novice", label: "Novice", detail: "1.0–2.5" }, { value: "intermediate", label: "Intermediate", detail: "2.5–4.0" }, { value: "advanced", label: "Advanced", detail: "4.0–5.5" }]} /></section>
        <section className="open-play-step-card"><div className="form-field"><label htmlFor="preadd-players">ADD PLAYERS NOW · OPTIONAL · {guestNames.length + (includeOrganizer ? 1 : 0)} ADDED</label><textarea id="preadd-players" value={playerNames} onChange={(event) => setPlayerNames(event.target.value)} placeholder="One player name per line" /></div><button className={`organizer-playing ${includeOrganizer ? "selected" : ""}`} type="button" role="checkbox" aria-checked={includeOrganizer} onClick={() => setIncludeOrganizer((current) => !current)}><span>{includeOrganizer ? <Check size={14} /> : <Users size={14} />}</span><span><strong>I’m playing too</strong><small>Add the organizer to the first waiting pool.</small></span></button><div className="form-field"><label htmlFor="player-fee">PLAYER FEE · PHP</label><input id="player-fee" type="number" inputMode="decimal" min="0" step="1" value={fee} onChange={(event) => setFee(event.target.value)} /></div>{customizingRules ? <><div className="form-field"><label htmlFor="session-rules">SESSION RULES</label><input id="session-rules" value={rules} onChange={(event) => setRules(event.target.value)} maxLength={180} /></div><div className="form-field"><label htmlFor="cancel-policy">CANCELLATION POLICY</label><textarea id="cancel-policy" value={cancellationPolicy} onChange={(event) => setCancellationPolicy(event.target.value)} maxLength={300} /></div><button className="text-action" type="button" onClick={() => setCustomizingRules(false)}>Use default wording <ChevronUp size={13} /></button></> : <div className="form-field"><label>RULES & CANCELLATION POLICY</label><div className="publish-notice"><Sparkles size={17} /><span>Using standard wording: &ldquo;{rules}&rdquo; and a normal cancellation policy. <button type="button" className="text-action" onClick={() => setCustomizingRules(true)}>Customize <ChevronDown size={13} /></button></span></div></div>}{!stepThreeValid ? <small className="field-help">Check the player count, fee, rules, and cancellation policy.</small> : null}<div className="open-play-review"><span>READY TO PUBLISH</span><strong>{name}</strong><small>{date} · {startTime}–{endTime} · {selectedCourtIds.length} court{selectedCourtIds.length === 1 ? "" : "s"} · {capacity} players</small></div></section></div> : null}

      <div className="dialog-actions open-play-actions"><button className="button button-ghost" type="button" onClick={step === 1 ? onClose : () => setStep((current) => current - 1)}>{step === 1 ? "Cancel" : <><ArrowLeft size={15} />Back</>}</button>{step < 3 ? <button className="button button-accent" type="button" disabled={step === 1 ? !stepOneValid : !stepTwoValid} onClick={() => { if (step === 2) stepThreeEnteredAt.current = Date.now(); setStep((current) => current + 1); }}>{step === 1 ? "Continue to rotation" : "Continue to players"}<ArrowRight size={16} /></button> : <button className="button button-accent" type="button" disabled={busy || !stepOneValid || !stepTwoValid || !stepThreeValid} onClick={() => void publish()}>{busy ? "Publishing…" : "Publish open play"}<Check size={16} /></button>}</div>
    </form>
  </div></div>;
}
