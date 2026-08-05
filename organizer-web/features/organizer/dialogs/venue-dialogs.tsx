"use client";

import { ArrowLeft, ArrowRight, Building2, Check, Eye, Grid2X2, ImagePlus, MapPin, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { saveCourtImage, validateOrganizerImage } from "@/lib/organizer-media";
import { requireSupabase } from "@/lib/supabase";
import type { Venue } from "@/lib/types";
import { TimeControl } from "../components/schedule-control";
import { SelectControl } from "../components/portal-ui";

function DialogFrame({ eyebrow, title, detail, onClose, children }: { eyebrow: string; title: string; detail: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="venue-dialog-title"><div className="dialog-head"><div><p className="eyebrow">{eyebrow}</p><h2 id="venue-dialog-title">{title}</h2><p>{detail}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>{children}</div></div>;
}

export function CreateCourtDialog({ venue, onClose, onCreated }: { venue: Venue; onClose: () => void; onCreated: () => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(`Court ${venue.courts.length + 1}`);
  const [environment, setEnvironment] = useState(venue.venue_type || "Indoor");
  const [surface, setSurface] = useState("Standard acrylic");
  const [price, setPrice] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const continueToPricing = () => {
    if (name.trim().length < 2) { toast.error("Enter a court name."); return; }
    setStep(2);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const hourlyPrice = Number(price);
    if (surface.trim().length < 2) { toast.error("Choose a court surface."); return; }
    if (price.trim() === "" || !Number.isFinite(hourlyPrice) || hourlyPrice < 0) { toast.error("Enter a valid non-negative hourly price."); return; }
    try { if (image) validateOrganizerImage(image); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "Choose a valid court photo."); return; }
    setBusy(true);
    try {
      const { data, error } = await requireSupabase().rpc("create_venue_court", { p_venue_id: venue.id, p_name: name.trim(), p_environment: environment, p_surface: surface.trim(), p_hourly_price: hourlyPrice });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      if (image && created?.id) {
        try { await saveCourtImage(venue.id, created.id, image); }
        catch { toast.warning("Court added, but its photo could not be uploaded. You can add it later."); }
      }
      toast.success("Court added to the venue.");
      await onCreated();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Court creation failed."); }
    finally { setBusy(false); }
  };
  return <DialogFrame eyebrow={`NEW COURT · STEP ${step} OF 2`} title={step === 1 ? "Set the court basics" : "Pricing and player view"} detail={`Add a bookable court at ${venue.name}.`} onClose={onClose}><form onSubmit={submit}>
    <div className="form-progress" aria-label={`Step ${step} of 2`}><span className="active" /><span className={step === 2 ? "active" : ""} /></div>
    {step === 1 ? <div className="wizard-panel">
      <div className="friendly-intro"><span><Grid2X2 size={19} /></span><div><strong>{venue.name}</strong><small>Set the basic court details players need. You can edit these later.</small></div></div>
      <div className="form-field"><label htmlFor="court-name">COURT NAME</label><input id="court-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Court 1" minLength={2} maxLength={80} required autoFocus /></div>
      <fieldset className="choice-field"><legend>ENVIRONMENT</legend><div className="choice-row">{["Indoor", "Outdoor", "Mixed"].map((item) => <button className={environment === item ? "selected" : ""} type="button" aria-pressed={environment === item} key={item} onClick={() => setEnvironment(item)}>{item}{environment === item ? <Check size={14} /> : null}</button>)}</div></fieldset>
    </div> : <div className="wizard-panel">
      <div className="wizard-review"><Grid2X2 size={18} /><div><strong>{name}</strong><small>{environment} · {venue.name}</small></div><button type="button" onClick={() => setStep(1)}>EDIT</button></div>
      <fieldset className="choice-field"><legend>COURT SURFACE</legend><div className="surface-choice-grid">{["Standard acrylic", "Concrete", "Wood", "Synthetic"].map((item) => <button className={surface === item ? "selected" : ""} type="button" aria-pressed={surface === item} key={item} onClick={() => setSurface(item)}><span>{surface === item ? <Check size={13} /> : null}</span>{item}</button>)}</div></fieldset>
      <div className="form-field"><label htmlFor="court-price">REGULAR HOURLY PRICE</label><div className="money-input"><span>₱</span><input id="court-price" value={price} onChange={(event) => setPrice(event.target.value)} type="number" min="0" step="1" placeholder="500" required /></div><small className="field-help">This is the standard price players see. Peak and promo prices are added separately.</small></div>
      <div className="form-field"><label htmlFor="court-photo">COURT PHOTO · OPTIONAL</label><label className="media-picker" htmlFor="court-photo"><span><ImagePlus size={20} /></span><span><strong>{image ? image.name : "Choose a court photo"}</strong><small>{image ? `${(image.size / 1024 / 1024).toFixed(1)} MB selected` : "JPG, PNG, or WebP · up to 4 MB"}</small></span><strong>{image ? "CHANGE" : "BROWSE"}</strong></label><input className="file-input" id="court-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0] || null)} /></div>
      <div className="publish-notice"><Eye size={17} /><span>This court becomes visible to players after you add it. You can hide it anytime.</span></div>
    </div>}
    <div className="dialog-actions wizard-actions"><button className="button button-ghost" type="button" onClick={step === 1 ? onClose : () => setStep(1)}>{step === 1 ? "Cancel" : <><ArrowLeft size={15} />Back</>}</button>{step === 1 ? <button className="button button-accent" type="button" onClick={continueToPricing}>Continue<ArrowRight size={16} /></button> : <button className="button button-accent" type="submit" disabled={busy}>{busy ? "Adding court…" : "Add court"}<Check size={16} /></button>}</div>
  </form></DialogFrame>;
}

export function CreateVenueDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [venueType, setVenueType] = useState("Indoor");
  const [opensAt, setOpensAt] = useState("06:00");
  const [closesAt, setClosesAt] = useState("22:00");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const values = new FormData(event.currentTarget);
    try {
      const { error } = await requireSupabase().rpc("create_venue_application", { p_name: String(values.get("name") || "").trim(), p_area: String(values.get("area") || "").trim(), p_address: String(values.get("address") || "").trim(), p_venue_type: venueType, p_google_maps_url: String(values.get("maps_url") || "").trim(), p_description: String(values.get("description") || "").trim() || null, p_opens_at: opensAt, p_closes_at: closesAt, p_latitude: Number(values.get("latitude")), p_longitude: Number(values.get("longitude")) });
      if (error) throw error;
      toast.success("Venue submitted for verification.");
      await onCreated();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Venue creation failed."); }
    finally { setBusy(false); }
  };
  return <DialogFrame eyebrow="NEW LOCATION" title="Add a venue" detail="Create the location first. Courts and activities are managed after submission." onClose={onClose}><form onSubmit={submit}><div className="dialog-section"><span><Building2 size={18} /></span><div><strong>Venue identity</strong><small>Use the public name and address players will recognize.</small></div></div><div className="dialog-grid"><div className="form-field full"><label htmlFor="venue-name">VENUE NAME</label><input id="venue-name" name="name" placeholder="e.g. Peakle Sports Center" minLength={2} required autoFocus /></div><div className="form-field"><label htmlFor="venue-area">CITY OR AREA</label><input id="venue-area" name="area" placeholder="e.g. Makati City" minLength={2} required /></div><div className="form-field"><label>VENUE TYPE</label><SelectControl value={venueType} onChange={setVenueType} ariaLabel="Venue type" options={[{ value: "Indoor", label: "Indoor" }, { value: "Outdoor", label: "Outdoor" }, { value: "Mixed", label: "Mixed" }]} /></div><div className="form-field full"><label htmlFor="venue-address">FULL ADDRESS</label><input id="venue-address" name="address" placeholder="Street, barangay, city" minLength={5} required /></div><div className="form-field"><label>OPENS</label><TimeControl value={opensAt} onChange={setOpensAt} ariaLabel="Opening time" /></div><div className="form-field"><label>CLOSES</label><TimeControl value={closesAt} onChange={setClosesAt} ariaLabel="Closing time" /></div></div><div className="dialog-section"><span><MapPin size={18} /></span><div><strong>Map verification</strong><small>Coordinates and a Google Maps share link keep directions accurate.</small></div></div><div className="dialog-grid"><div className="form-field full"><label htmlFor="venue-map">GOOGLE MAPS SHARE LINK</label><input id="venue-map" name="maps_url" type="url" placeholder="https://maps.app.goo.gl/..." required /></div><div className="form-field"><label htmlFor="venue-latitude">LATITUDE</label><input id="venue-latitude" name="latitude" type="number" step="any" placeholder="14.5547" required /></div><div className="form-field"><label htmlFor="venue-longitude">LONGITUDE</label><input id="venue-longitude" name="longitude" type="number" step="any" placeholder="121.0244" required /></div><div className="form-field full"><label htmlFor="venue-description">DESCRIPTION · OPTIONAL</label><textarea id="venue-description" name="description" placeholder="Facilities, parking, and arrival notes" /></div></div><div className="dialog-actions"><button className="button button-ghost" type="button" onClick={onClose}>Cancel</button><button className="button button-accent" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit venue"}<Check size={16} /></button></div></form></DialogFrame>;
}
