"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { programCounts, programInputDate, validateProgramDetails, type ProgramDetails } from "@/lib/program-utils";
import { saveProgramDetails } from "@/lib/programs";
import type { Program } from "@/lib/types";
import { SelectControl } from "../components/portal-ui";

export function ProgramDialogFrame({ title, detail, busy, onClose, children }: { title: string; detail: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length);
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); previousFocus?.focus(); };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="dialog dialog-wide program-dialog" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="program-dialog-title" aria-describedby="program-dialog-detail" aria-busy={busy}>
      <div className="dialog-head"><div><p className="eyebrow">PROGRAM MANAGEMENT</p><h2 id="program-dialog-title">{title}</h2><p id="program-dialog-detail">{detail}</p></div><button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}

export function EditProgramDialog({ program, onClose, onSaved }: { program: Program; onClose: () => void; onSaved: () => Promise<void> }) {
  const [original] = useState(program);
  const [started] = useState(() => Boolean(program.starts_at && new Date(program.starts_at).getTime() <= Date.now()));
  const [name, setName] = useState(program.name);
  const [kind, setKind] = useState(program.kind || "clinic");
  const [skill, setSkill] = useState(program.skill_division || "all");
  const [start, setStart] = useState(programInputDate(program.starts_at));
  const [end, setEnd] = useState(programInputDate(program.ends_at));
  const [capacity, setCapacity] = useState(String(program.capacity ?? 16));
  const [price, setPrice] = useState(String(program.price ?? 0));
  const [description, setDescription] = useState(program.description || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { registered } = programCounts(program);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const details: ProgramDetails = { name: name.trim(), kind, skill_division: skill, starts_at: `${start}:00+08:00`, ends_at: `${end}:00+08:00`, capacity: Number(capacity), price: Number(price), description: description.trim() || null };
    const validation = validateProgramDetails(details, registered);
    if (validation) { setError(validation); return; }
    if (start !== programInputDate(original.starts_at) && new Date(details.starts_at!).getTime() <= Date.now()) { setError("Choose a new start time in the future."); return; }
    if (new Date(details.ends_at!).getTime() <= Date.now()) { setError("Choose an end time in the future."); return; }
    // Preserve the stored timestamp when its minute-level input was not edited.
    details.starts_at = start === programInputDate(original.starts_at) ? original.starts_at : new Date(details.starts_at!).toISOString();
    details.ends_at = end === programInputDate(original.ends_at) ? original.ends_at : new Date(details.ends_at!).toISOString();
    setBusy(true); setError(null);
    try { await saveProgramDetails(original, details); toast.success("Program details updated."); await onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The program could not be updated."); }
    finally { setBusy(false); }
  };
  return <ProgramDialogFrame title="Edit program" detail="Update the details players see. All times are Philippine time (PHT)." busy={busy} onClose={onClose}>
    <form onSubmit={submit}>
      <fieldset className="program-edit-fields" disabled={busy}>
        <div className="form-field full"><label htmlFor="program-name">PROGRAM NAME</label><input id="program-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={3} maxLength={100} /></div>
        <div className="form-field"><label htmlFor="program-kind">TYPE</label><SelectControl id="program-kind" value={kind} onChange={setKind} disabled={busy} ariaLabel="Program type" options={[{ value: "clinic", label: "Clinic" }, { value: "coaching", label: "Coaching" }, { value: "camp", label: "Camp" }, { value: "open_play", label: "Open play" }]} /></div>
        <div className="form-field"><label htmlFor="program-skill">SKILL LEVEL</label><SelectControl id="program-skill" value={skill} onChange={setSkill} disabled={busy} ariaLabel="Program skill level" options={[{ value: "all", label: "All skill levels" }, { value: "beginner", label: "Beginner" }, { value: "intermediate", label: "Intermediate" }, { value: "advanced", label: "Advanced" }]} /></div>
        <div className="form-field"><label htmlFor="program-start">START · PHT</label><input id="program-start" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} disabled={started} required />{started ? <small className="field-help">The program has already started.</small> : null}</div>
        <div className="form-field"><label htmlFor="program-end">END · PHT</label><input id="program-end" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></div>
        <div className="form-field"><label htmlFor="program-capacity">CAPACITY</label><input id="program-capacity" type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} min={Math.max(1, registered)} max={200} step={1} required /><small className="field-help">{registered} registered · Maximum 200 players</small></div>
        <div className="form-field"><label htmlFor="program-price">PRICE PER PLAYER · PHP</label><input id="program-price" type="number" value={price} onChange={(event) => setPrice(event.target.value)} min={0} max={99999999.99} step="0.01" required /><small className="field-help">Enter 0 for a free program.</small></div>
        <div className="form-field full"><label htmlFor="program-description">DESCRIPTION · OPTIONAL</label><textarea id="program-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What players will learn, what to bring, and other useful details." /></div>
      </fieldset>
      {error ? <p className="program-inline-error" role="alert">{error}</p> : null}
      <div className="dialog-actions"><button className="button button-ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button-accent" type="submit" disabled={busy}><Check size={16} />{busy ? "Saving…" : "Save changes"}</button></div>
    </form>
  </ProgramDialogFrame>;
}

export function ProgramConfirmDialog({ title, detail, confirm, danger = false, onClose, onConfirm }: { title: string; detail: string; confirm: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };
  return <ProgramDialogFrame title={title} detail={detail} busy={busy} onClose={onClose}>
    {error ? <p className="program-inline-error" role="alert">{error}</p> : null}
    <div className="dialog-actions"><button className="button button-ghost" type="button" disabled={busy} onClick={onClose}>Go back</button><button className={`button ${danger ? "button-danger" : "button-accent"}`} type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : confirm}</button></div>
  </ProgramDialogFrame>;
}
