"use client";

import { Copy, ExternalLink, Monitor, Plus, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { OrganizerData } from "@/lib/types";
import type { DisplayInput, DisplayMode, DisplaySetup, VenueDisplay } from "@/lib/scoreboard-types";
import { assignDisplayCourt, deleteDisplay, displayLink, listDisplays, loadDisplaySetup, resetDisplayLink, saveDisplay } from "@/lib/scoreboard";
import { withTimeout } from "@/lib/async";
import { isDemoModeActive } from "@/lib/demo-mode";
import "./display-settings.css";

const modes: Record<DisplayMode, string> = { court: "One court scoreboard", all_courts: "All court scoreboards", bracket: "Tournament bracket", standings: "Division standings" };
const message = (error: unknown) => error instanceof Error ? error.message : "The display could not be updated.";
type Source = { value: string; name: string; kind: string };

function DisplayForm({ venueId, sources, initialSource, existing, onSaved, onCancel }: {
  venueId: string; sources: Source[]; initialSource: string; existing: VenueDisplay | null; onSaved: () => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name || "");
  const [source, setSource] = useState(existing ? `${existing.source_kind}:${existing.source_id}` : initialSource || sources[0]?.value || "");
  const [mode, setMode] = useState<DisplayMode>(existing?.mode || "court");
  const [courtId, setCourtId] = useState(existing?.court_id || "");
  const [divisionId, setDivisionId] = useState(existing?.division_id || "");
  const [loaded, setLoaded] = useState<{ source: string; data: DisplaySetup } | null>(null);
  const [setupError, setSetupError] = useState<{ source: string; message: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupVersion, setSetupVersion] = useState(0);
  const sourceKind = source.startsWith("competition:") ? "competition" : "open_play";
  const sourceId = source.slice(source.indexOf(":") + 1);
  const setup = loaded?.source === source ? loaded.data : null;
  const currentError = setupError?.source === source ? setupError.message : "";
  const selectedSource = sources.find((item) => item.value === source);

  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    void withTimeout(loadDisplaySetup(sourceKind, sourceId, venueId), 10000, "Courts could not be loaded. Check your connection.").then((data) => {
      if (active) { setLoaded({ source, data }); setSetupError(null); }
    }).catch((reason) => { if (active) setSetupError({ source, message: message(reason) }); });
    return () => { active = false; };
  }, [source, sourceId, sourceKind, venueId, setupVersion]);

  const validCourt = setup?.courts.some((court) => court.id === courtId);
  const validDivision = setup?.divisions.some((division) => division.id === divisionId);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !setup) return;
    if (!selectedSource) { setError("Choose an event at this venue."); return; }
    if (mode === "court" && !validCourt) { setError("Choose a court for this display."); return; }
    if (["bracket", "standings"].includes(mode) && !validDivision) { setError("Choose a division for this display."); return; }
    setBusy(true); setError("");
    const input: DisplayInput = { venue_id: venueId, name: name.trim(), source_kind: sourceKind, source_id: sourceId, mode, court_id: mode === "court" ? courtId : null, division_id: sourceKind === "competition" && validDivision ? divisionId : null };
    try { await saveDisplay(input, existing); toast.success(existing ? "Display settings updated." : "Display created. Open its link on the court screen."); await onSaved(); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  };
  const assign = async (match: DisplaySetup["matches"][number], court: string) => {
    setBusy(true); setError("");
    try {
      await withTimeout(assignDisplayCourt(match, court || null), 10000, "Court assignment took too long. Reload courts before retrying.");
      setLoaded({ source, data: await loadDisplaySetup(sourceKind, sourceId, venueId) });
      toast.success("Match court updated.");
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  };

  return <form className="display-editor" onSubmit={(event) => void save(event)}>
    <h3>{existing ? "Edit display" : "Add a display"}</h3>
    <fieldset disabled={busy}>
      <label className="display-field">Display name<input id="display-name" autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Court 1 TV" /></label>
      <label className="display-field">Event<select id="display-source" value={source} required onChange={(event) => { setSource(event.target.value); setCourtId(""); setDivisionId(""); setMode("court"); setError(""); }}>
        <option value="" disabled>Choose an event</option>{!selectedSource && source ? <option value={source} disabled>Event no longer available</option> : null}
        {sources.map((item) => <option key={item.value} value={item.value}>{item.name} · {item.kind}</option>)}
      </select></label>
      <div className="display-field-grid">
        <label className="display-field">Show<select id="display-mode" value={mode} onChange={(event) => { setMode(event.target.value as DisplayMode); setError(""); }}>
          <option value="court">One court scoreboard</option><option value="all_courts">All court scoreboards</option>
          {selectedSource?.kind === "tournament" ? <option value="bracket">Tournament bracket</option> : null}
          {sourceKind === "competition" ? <option value="standings">Division standings</option> : null}
        </select></label>
        {mode === "court" ? <label className="display-field">Court<select id="display-court" value={validCourt ? courtId : ""} required disabled={!setup} onChange={(event) => setCourtId(event.target.value)}>
          <option value="">{setup ? "Choose a court" : "Loading courts…"}</option>{setup?.courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}
        </select></label> : null}
        {sourceKind === "competition" ? <label className="display-field">Division<select id="display-division" value={validDivision ? divisionId : ""} required={["bracket", "standings"].includes(mode)} disabled={!setup} onChange={(event) => setDivisionId(event.target.value)}>
          <option value="">{["bracket", "standings"].includes(mode) ? "Choose a division" : "All divisions"}</option>{setup?.divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
        </select></label> : null}
      </div>
      {setup && mode === "court" && !setup.courts.length ? <p className="display-error">Add courts to this {sourceKind === "open_play" ? "session" : "venue"} before assigning a scoreboard.</p> : null}
      {currentError ? <p className="display-error" role="alert">{currentError} <button type="button" onClick={() => setSetupVersion((value) => value + 1)}>Retry</button></p> : null}
      {sourceKind === "competition" && setup ? <details className="display-assignments"><summary>Match court assignments ({setup.matches.length})</summary>
        <p>Assign scheduled or live matches to their physical court. The scoreboard follows the next match on that court.</p>
        {setup.matches.length ? setup.matches.map((match) => <label key={match.id} className="display-assignment"><span><strong>{match.label}</strong><small>{match.status === "live" ? "Live now" : "Upcoming"}</small></span><select aria-label={`Court for ${match.label}`} value={match.court_id || ""} onChange={(event) => void assign(match, event.target.value)}><option value="">Unassigned</option>{setup.courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label>) : <p>Schedule matches in the competition first. They will appear here for court assignment.</p>}
      </details> : null}
    </fieldset>
    <p className="display-help">Each display has its own link. Open it on the court computer, then choose Full screen. Scores and settings update automatically.</p>
    {error ? <p className="display-error" role="alert">{error}</p> : null}
    <div className="display-editor-actions"><button type="button" className="button button-ghost" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="button button-accent" disabled={busy || !setup || !selectedSource || !name.trim()}>{busy ? "Saving…" : existing ? "Save display" : "Create display"}</button></div>
  </form>;
}

function DisplaySettingsDialog({ data, venueId, initialSource, onClose }: { data: OrganizerData; venueId: string; initialSource: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [displays, setDisplays] = useState<VenueDisplay[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<VenueDisplay | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [confirm, setConfirm] = useState<{ display: VenueDisplay; action: "disconnect" | "replace" | "delete" } | null>(null);
  const venue = data.venues.find((item) => item.id === venueId)!;
  const sources: Source[] = [
    ...data.sessions.filter((item) => item.venue_id === venueId).map((item) => ({ value: `open_play:${item.id}`, name: item.name, kind: "Open play" })),
    ...data.competitions.filter((item) => item.venue_id === venueId).map((item) => ({ value: `competition:${item.id}`, name: item.name, kind: item.kind || "competition" })),
  ];
  const refresh = useCallback(async () => {
    try { setDisplays(await listDisplays(venueId)); setError(""); }
    catch (reason) { setError(message(reason)); }
  }, [venueId]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 6000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);
  const copy = async (display: VenueDisplay) => {
    try { await navigator.clipboard.writeText(displayLink(display.token)); toast.success("Display link copied."); }
    catch { toast.error("Copy is unavailable. Open the display and copy its address."); }
  };
  const reset = async () => {
    if (!confirm || busyId) return;
    setBusyId(confirm.display.id);
    try {
      if (confirm.action === "delete") {
        await deleteDisplay(confirm.display);
        if (editing?.id === confirm.display.id) { setEditing(null); setShowForm(false); }
        toast.success("Display deleted. Match and score data are preserved.");
      } else {
        await resetDisplayLink(confirm.display, confirm.action === "disconnect");
        toast.success(confirm.action === "disconnect" ? "Display disconnected. Its previous link no longer works." : "New link created. Open it on the court screen.");
      }
      setConfirm(null); await refresh();
    }
    catch (reason) { setError(message(reason)); }
    finally { setBusyId(""); }
  };
  return <dialog ref={dialog} className="display-settings-dialog" aria-labelledby="display-settings-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="display-settings-head"><div><p className="eyebrow">LIVE MONITOR SETTINGS · {venue.name}</p><h2 id="display-settings-title">Manage displays</h2></div><button className="icon-button" type="button" aria-label="Close display settings" onClick={onClose}><X size={20} /></button></header>
    <p className="display-help">Keep event management on the main computer. Give each court screen its own read-only scoreboard.</p>
    {isDemoModeActive() ? <p className="display-help">Demo displays work in tabs of this browser only. Sign in with your organizer account to connect screens on other computers.</p> : null}
    {error ? <p className="display-error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Refresh</button></p> : null}
    {displays === null && !error ? <p role="status">Loading displays…</p> : null}
    {displays?.length === 0 ? <div className="display-empty"><Monitor size={30} /><h3>Your courts, on their own screens</h3><p>Add a display for Court 1, another for Court 2, or a shared venue board.</p></div> : null}
    <div className="display-list">{displays?.map((display) => <article key={display.id} className="display-list-item" data-display-id={display.id}>
      <div className="display-list-title"><Monitor size={22} /><div><h3>{display.name}</h3><p>{sources.find((source) => source.value === `${display.source_kind}:${display.source_id}`)?.name || "Event unavailable"} · {modes[display.mode]}</p></div><span className={display.enabled ? "display-enabled" : "display-disabled"}>{display.enabled ? "Enabled" : "Disconnected"}</span></div>
      <div className="display-list-actions"><button type="button" className="mini-button" onClick={() => { setEditing(display); setShowForm(true); setConfirm(null); }}>Edit settings</button>
        {display.enabled ? <><button type="button" className="mini-button" onClick={() => void copy(display)}><Copy size={14} />Copy link</button><a className="mini-button" href={displayLink(display.token)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Open display</a></> : null}
        <button type="button" className="mini-button" disabled={Boolean(busyId)} onClick={() => setConfirm({ display, action: "replace" })}>New link</button>
        {display.enabled ? <button type="button" className="mini-button" disabled={Boolean(busyId)} onClick={() => setConfirm({ display, action: "disconnect" })}>Disconnect</button> : null}
        <button type="button" className="mini-button danger" disabled={Boolean(busyId)} onClick={() => setConfirm({ display, action: "delete" })}>Delete</button>
      </div>
    </article>)}</div>
    {confirm ? <div className="display-confirm" role="alert"><strong>{confirm.action === "delete" ? `Delete ${confirm.display.name}?` : confirm.action === "disconnect" ? `Disconnect ${confirm.display.name}?` : `Replace the link for ${confirm.display.name}?`}</strong><p>{confirm.action === "delete" ? "This permanently removes the display settings and disconnects its screen. Match history, scores, and court data are kept." : `Any screen using the previous link will disconnect. ${confirm.action === "disconnect" ? "Create a new link when you want to reconnect it." : "Open the new link on the court screen to reconnect."}`}</p><div className="display-editor-actions"><button type="button" className="button button-ghost" disabled={Boolean(busyId)} onClick={() => setConfirm(null)}>{confirm.action === "delete" ? "Keep display" : "Keep current link"}</button><button type="button" className="button button-danger" disabled={Boolean(busyId)} onClick={() => void reset()}>{busyId ? "Updating…" : confirm.action === "delete" ? "Delete display" : confirm.action === "disconnect" ? "Disconnect display" : "Replace link"}</button></div></div> : null}
    {showForm ? <DisplayForm key={editing?.id || "new"} venueId={venueId} sources={sources} initialSource={initialSource} existing={editing} onCancel={() => setShowForm(false)} onSaved={async () => { setShowForm(false); setEditing(null); await refresh(); }} /> : <button type="button" className="button button-accent display-add" disabled={!sources.length || displays === null} onClick={() => { setEditing(null); setShowForm(true); setConfirm(null); }}><Plus size={17} />Add display</button>}
    {!sources.length ? <p className="display-help">Create an open-play session or competition at this venue to set up displays.</p> : null}
  </dialog>;
}

export function DisplaySettingsButton({ data, venueId, source, panel = false }: { data: OrganizerData; venueId: string | null; source: string; panel?: boolean }) {
  const [open, setOpen] = useState(false);
  const venue = data.venues.find((item) => item.id === venueId) || data.venues[0];
  if (!venue || !["owner", "manager", "admin"].includes(venue.role)) return null;
  return <><div className={`display-settings-launch${panel ? " display-settings-panel" : ""}`}><button type="button" className={`button ${panel ? "button-accent" : "button-ghost"}`} onClick={() => setOpen(true)}><Settings2 size={17} />Manage displays</button></div>{open ? createPortal(<DisplaySettingsDialog key={venue.id} data={data} venueId={venue.id} initialSource={source.replace(/^session:/, "open_play:")} onClose={() => setOpen(false)} />, document.fullscreenElement || document.body) : null}</>;
}
