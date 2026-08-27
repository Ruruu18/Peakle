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
      const { data, error } = await requireSupabase().rpc("create_venue_court", { p_venue_id: venue.id, p_name: name.trim(), p_environment: environment, p_surface: surface.trim(), p_owner_hourly_price: hourlyPrice });
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
      <div className="form-field"><label htmlFor="court-price">REGULAR HOURLY PRICE</label><div className="money-input"><span>₱</span><input id="court-price" value={price} onChange={(event) => setPrice(event.target.value)} type="number" min="0" step="1" placeholder="500" required /></div><small className="field-help">This is what you earn per hour. Peakle adds its service fee on top for the price players pay. Peak and promo prices are added separately.</small></div>
      <div className="form-field"><label htmlFor="court-photo">COURT PHOTO · OPTIONAL</label><label className="media-picker" htmlFor="court-photo"><span><ImagePlus size={20} /></span><span><strong>{image ? image.name : "Choose a court photo"}</strong><small>{image ? `${(image.size / 1024 / 1024).toFixed(1)} MB selected` : "JPG, PNG, or WebP · up to 4 MB"}</small></span><strong>{image ? "CHANGE" : "BROWSE"}</strong></label><input className="file-input" id="court-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0] || null)} /></div>
      <div className="publish-notice"><Eye size={17} /><span>This court becomes visible to players after you add it. You can hide it anytime.</span></div>
    </div>}
    <div className="dialog-actions wizard-actions"><button className="button button-ghost" type="button" onClick={step === 1 ? onClose : () => setStep(1)}>{step === 1 ? "Cancel" : <><ArrowLeft size={15} />Back</>}</button>{step === 1 ? <button className="button button-accent" type="button" onClick={continueToPricing}>Continue<ArrowRight size={16} /></button> : <button className="button button-accent" type="submit" disabled={busy}>{busy ? "Adding court…" : "Add court"}<Check size={16} /></button>}</div>
  </form></DialogFrame>;
}

// Google Maps share links often embed the coordinates directly (desktop URLs,
// "@lat,lng" pins, or "q="/"ll=" query params). Short maps.app.goo.gl links
// redirect server-side and can't be resolved from the browser, so those still
// need the manual fallback below.
function coordinatesFromMapsUrl(url: string): { lat: number; lng: number } | null {
  const patterns = [/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, /[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, /[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

export function CreateVenueDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [venueType, setVenueType] = useState("Indoor");
  const [opensAt, setOpensAt] = useState("06:00");
  const [closesAt, setClosesAt] = useState("22:00");
  const [mapsUrl, setMapsUrl] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [description, setDescription] = useState("");
  const [detected, setDetected] = useState(false);
  const [editingCoordinates, setEditingCoordinates] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleMapsUrlChange = (value: string) => {
    setMapsUrl(value);
    const coordinates = coordinatesFromMapsUrl(value);
    if (coordinates) {
      setLatitude(String(coordinates.lat));
      setLongitude(String(coordinates.lng));
      setDetected(true);
      setEditingCoordinates(false);
    } else {
      setDetected(false);
    }
  };

  const goToStep2 = () => {
    if (name.trim().length < 2) { toast.error("Enter the venue name."); return; }
    if (area.trim().length < 2) { toast.error("Enter the city or area."); return; }
    if (address.trim().length < 5) { toast.error("Enter the full address."); return; }
    setStep(2);
  };

  const goToStep3 = () => setStep(3);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (latitude.trim() === "" || longitude.trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error("We couldn't detect coordinates from that link — enter latitude and longitude manually.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc("create_venue_application", {
        p_name: name.trim(),
        p_area: area.trim(),
        p_address: address.trim(),
        p_venue_type: venueType,
        p_google_maps_url: mapsUrl.trim(),
        p_description: description.trim() || null,
        p_opens_at: opensAt,
        p_closes_at: closesAt,
        p_latitude: lat,
        p_longitude: lng,
      });
      if (error) throw error;
      toast.success("Venue submitted for verification.");
      await onCreated();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Venue creation failed."); }
    finally { setBusy(false); }
  };

  const STEP_TITLES = ["Venue identity", "Operating hours", "Location & map"];
  const STEP_DETAILS = [
    "Name and address players will recognize.",
    "When your venue is open for bookings.",
    "Pin your venue so players can find it.",
  ];

  return (
    <DialogFrame eyebrow={`NEW LOCATION · STEP ${step} OF 3`} title={STEP_TITLES[step - 1]} detail={STEP_DETAILS[step - 1]} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-progress" aria-label={`Step ${step} of 3`}>
          <span className="active" />
          <span className={step >= 2 ? "active" : ""} />
          <span className={step === 3 ? "active" : ""} />
        </div>

        {step === 1 && (
          <div className="wizard-panel">
            <div className="friendly-intro"><span><Building2 size={19} /></span><div><strong>What&apos;s the venue called?</strong><small>Use the public name and address players will recognize.</small></div></div>
            <div className="form-field">
              <label htmlFor="venue-name">VENUE NAME</label>
              <input id="venue-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Peakle Sports Center" minLength={2} required autoFocus />
            </div>
            <div className="dialog-grid" style={{ marginTop: 0 }}>
              <div className="form-field">
                <label htmlFor="venue-area">CITY OR AREA</label>
                <input id="venue-area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Makati City" minLength={2} required />
              </div>
              <div className="form-field">
                <label>VENUE TYPE</label>
                <SelectControl value={venueType} onChange={setVenueType} ariaLabel="Venue type" options={[{ value: "Indoor", label: "Indoor" }, { value: "Outdoor", label: "Outdoor" }, { value: "Mixed", label: "Mixed" }]} />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="venue-address">FULL ADDRESS</label>
              <input id="venue-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, barangay, city" minLength={5} required />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-panel">
            <div className="friendly-intro"><span><Building2 size={19} /></span><div><strong>{name}</strong><small>{venueType} · {area}</small></div></div>
            <div className="dialog-grid">
              <div className="form-field">
                <label>OPENS</label>
                <TimeControl value={opensAt} onChange={setOpensAt} ariaLabel="Opening time" />
              </div>
              <div className="form-field">
                <label>CLOSES</label>
                <TimeControl value={closesAt} onChange={setClosesAt} ariaLabel="Closing time" />
              </div>
            </div>
            <div className="form-field" style={{ marginTop: 8 }}>
              <label htmlFor="venue-description">DESCRIPTION · OPTIONAL</label>
              <textarea id="venue-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Facilities, parking, and arrival notes" />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-panel">
            <div className="friendly-intro"><span><MapPin size={19} /></span><div><strong>Pin {name} on the map</strong><small>Paste a Google Maps share link — we&apos;ll read the coordinates automatically.</small></div></div>
            <div className="form-field">
              <label htmlFor="venue-map">GOOGLE MAPS SHARE LINK</label>
              <input id="venue-map" name="maps_url" type="url" value={mapsUrl} onChange={(e) => handleMapsUrlChange(e.target.value)} placeholder="https://maps.app.goo.gl/... or https://www.google.com/maps/@14.55,121.02" required />
            </div>
            {detected && !editingCoordinates ? (
              <div className="form-field">
                <div className="publish-notice"><MapPin size={17} /><span>Coordinates detected: {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}. <button type="button" className="text-action" onClick={() => setEditingCoordinates(true)}>Adjust manually</button></span></div>
              </div>
            ) : (
              <>
                <div className="form-field">
                  <small className="field-help">{mapsUrl.trim() ? "We couldn't read coordinates from that link. Open the link on desktop Google Maps, right-click the pin, and copy the coordinates shown at the top of the menu." : "Coordinates fill in automatically once you paste a link with a location on it."}</small>
                </div>
                <div className="dialog-grid">
                  <div className="form-field">
                    <label htmlFor="venue-latitude">LATITUDE</label>
                    <input id="venue-latitude" type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="14.5547" required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="venue-longitude">LONGITUDE</label>
                    <input id="venue-longitude" type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="121.0244" required />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="dialog-actions wizard-actions">
          <button className="button button-ghost" type="button" onClick={step === 1 ? onClose : () => setStep(step - 1)}>
            {step === 1 ? "Cancel" : <><ArrowLeft size={15} />Back</>}
          </button>
          {step === 1 && <button className="button button-accent" type="button" onClick={goToStep2}>Continue<ArrowRight size={16} /></button>}
          {step === 2 && <button className="button button-accent" type="button" onClick={goToStep3}>Continue<ArrowRight size={16} /></button>}
          {step === 3 && <button className="button button-accent" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit venue"}<Check size={16} /></button>}
        </div>
      </form>
    </DialogFrame>
  );
}
