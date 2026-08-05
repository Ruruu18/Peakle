"use client";

import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Minus, Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

const pad = (value: number) => String(value).padStart(2, "0");
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const manilaParts = (date = new Date()) => {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
};
export const manilaToday = () => manilaParts().date;
export const minimumFutureManilaTime = (date: string, now = new Date()) => {
  const current = manilaParts(now);
  if (date !== current.date) return undefined;
  const nextQuarter = Math.floor(current.minutes / 15) * 15 + 15;
  if (nextQuarter >= 24 * 60) return null;
  return `${pad(Math.floor(nextQuarter / 60))}:${pad(nextQuarter % 60)}`;
};
export const manilaDateTime = (value: string) => new Date(`${value}:00+08:00`);

const datePart = (value: string) => value.split("T")[0] || manilaToday();
const timePart = (value: string) => value.includes("T") ? value.split("T")[1]?.slice(0, 5) || "18:00" : "18:00";
const dateValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const timeMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const timeOptions = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = index % 4 * 15;
  const value = `${pad(hours)}:${pad(minutes)}`;
  const label = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 0, 1, hours, minutes));
  return { value, label };
});
const quickTimes = ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
const shiftTime = (value: string, amount: number) => {
  const [hours, minutes] = value.split(":").map(Number);
  const total = (hours * 60 + minutes + amount + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

const timeLabel = (value: string) => timeOptions.find((item) => item.value === value)?.label || value;

export function TimeControl({ value, onChange, ariaLabel, minValue }: { value: string; onChange: (value: string) => void; ariaLabel: string; minValue?: string | null }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "18:00");
  const [position, setPosition] = useState({ left: 12, top: 12, width: 340 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(":", "");
  const isAllowed = (candidate: string) => minValue === undefined || (minValue !== null && timeMinutes(candidate) >= timeMinutes(minValue));
  const shiftedDraft = (amount: number) => {
    if (minValue === undefined) return shiftTime(draft, amount);
    if (minValue === null) return null;
    const total = timeMinutes(draft) + amount;
    if (total < timeMinutes(minValue) || total >= 24 * 60) return null;
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };

  const openPicker = () => {
    setDraft(value && isAllowed(value) ? value : minValue || value || "18:00");
    setOpen(true);
  };
  const cancel = () => {
    setDraft(value || "18:00");
    setOpen(false);
  };
  const confirm = () => {
    if (!isAllowed(draft)) return;
    onChange(draft);
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const placePicker = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportGap = 12;
      const width = Math.min(340, window.innerWidth - viewportGap * 2);
      const left = Math.min(Math.max(viewportGap, rect.left), window.innerWidth - width - viewportGap);
      const pickerHeight = pickerRef.current?.offsetHeight || 350;
      const below = window.innerHeight - rect.bottom;
      const top = below >= pickerHeight + viewportGap
        ? rect.bottom + 8
        : Math.max(viewportGap, rect.top - pickerHeight - 8);
      setPosition({ left, top, width });
    };
    placePicker();
    window.addEventListener("resize", placePicker);
    window.addEventListener("scroll", placePicker, true);
    return () => {
      window.removeEventListener("resize", placePicker);
      window.removeEventListener("scroll", placePicker, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) cancel(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  });

  return <div ref={rootRef} className={`time-control ${open ? "open" : ""}`}>
    <button ref={triggerRef} className="time-trigger" type="button" aria-label={`${ariaLabel}, currently ${timeLabel(value)}`} aria-expanded={open} aria-controls={`time-picker-${id}`} onClick={open ? cancel : openPicker}>
      <span><Clock3 size={17} /></span><span><small>{ariaLabel}</small><strong>{timeLabel(value)}</strong></span><ChevronRight size={16} />
    </button>
    {open ? <div ref={pickerRef} className="time-picker" id={`time-picker-${id}`} role="group" aria-label={`${ariaLabel} picker`} style={{ left: position.left, top: position.top, width: position.width }}>
      <small className="time-picker-label">ADJUST IN 15-MINUTE STEPS</small>
      <div className="time-stepper"><button type="button" aria-label="15 minutes earlier" disabled={!shiftedDraft(-15)} onClick={() => { const next = shiftedDraft(-15); if (next) setDraft(next); }}><Minus size={21} /></button><div><strong>{timeLabel(draft)}</strong><small>TAP − OR + TO ADJUST</small></div><button className="add" type="button" aria-label="15 minutes later" disabled={!shiftedDraft(15)} onClick={() => { const next = shiftedDraft(15); if (next) setDraft(next); }}><Plus size={21} /></button></div>
      <div className="time-jumps"><button type="button" aria-label="One hour earlier" disabled={!shiftedDraft(-60)} onClick={() => { const next = shiftedDraft(-60); if (next) setDraft(next); }}><ChevronLeft size={14} />1 HOUR</button><button type="button" aria-label="One hour later" disabled={!shiftedDraft(60)} onClick={() => { const next = shiftedDraft(60); if (next) setDraft(next); }}>1 HOUR<ChevronRight size={14} /></button></div>
      <small className="time-picker-label quick">QUICK TIMES</small>
      <div className="time-quick">{quickTimes.map((item) => <button className={item === draft ? "selected" : ""} type="button" role="radio" aria-checked={item === draft} disabled={!isAllowed(item)} key={item} onClick={() => setDraft(item)}>{timeLabel(item)}{item === draft ? <Check size={13} /> : null}</button>)}</div>
      {minValue ? <small className="time-minimum-note">Past times are unavailable. Earliest: {timeLabel(minValue)}</small> : minValue === null ? <small className="time-minimum-note">No future time remains today. Choose a later date.</small> : null}
      <div className="time-picker-actions"><button type="button" onClick={cancel}>Cancel</button><button className="confirm" type="button" disabled={!isAllowed(draft)} onClick={confirm}>Use {timeLabel(draft)}<Check size={15} /></button></div>
    </div> : null}
  </div>;
}

export function ScheduleControl({ value, onChange, ariaLabel, dateOnly = false, inline = false, preventPast = true }: { value: string; onChange: (value: string) => void; ariaLabel: string; dateOnly?: boolean; inline?: boolean; preventPast?: boolean }) {
  const [open, setOpen] = useState(false);
  const selectedDate = datePart(value);
  const selectedTime = timePart(value);
  const parsedDate = new Date(`${selectedDate}T12:00:00`);
  const [month, setMonth] = useState(() => new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId().replaceAll(":", "");
  const currentDate = manilaToday();
  const minimumTime = preventPast && !dateOnly ? minimumFutureManilaTime(selectedDate) : undefined;
  const currentMonth = new Date(`${currentDate}T12:00:00`);
  const previousMonthDisabled = preventPast && (month.getFullYear() < currentMonth.getFullYear() || (month.getFullYear() === currentMonth.getFullYear() && month.getMonth() <= currentMonth.getMonth()));

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const days = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [month]);

  const selectDate = (nextDate: string) => {
    if (preventPast && (nextDate < currentDate || (!dateOnly && nextDate === currentDate && minimumFutureManilaTime(nextDate) === null))) return;
    const nextMinimum = preventPast && !dateOnly ? minimumFutureManilaTime(nextDate) : undefined;
    const nextTime = nextMinimum && selectedTime < nextMinimum ? nextMinimum : selectedTime;
    onChange(dateOnly ? nextDate : `${nextDate}T${nextTime}`);
    if (dateOnly) setOpen(false);
  };
  const selectTime = (nextTime: string) => {
    if (minimumTime && nextTime < minimumTime) return;
    onChange(`${selectedDate}T${nextTime}`);
  };
  const display = value
    ? new Intl.DateTimeFormat("en-PH", dateOnly ? { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" } : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(dateOnly ? `${selectedDate}T12:00:00+08:00` : `${selectedDate}T${selectedTime}:00+08:00`))
    : dateOnly ? "Choose date" : "Choose date and time";

  return <div ref={rootRef} className={`schedule-control ${inline ? "inline" : ""} ${open ? "open" : ""}`}>
    <button className="schedule-trigger" type="button" aria-label={ariaLabel} aria-expanded={open} aria-controls={`schedule-${id}`} onClick={() => setOpen((current) => !current)}><span className="schedule-trigger-icon"><CalendarDays size={17} /></span><span><small>{dateOnly ? "DATE" : "DATE & TIME"}</small><strong>{display}</strong></span><ChevronRight className="schedule-trigger-chevron" size={16} /></button>
    {inline || open ? <div id={`schedule-${id}`} className="schedule-popover" role="dialog" aria-label={ariaLabel}>
      <div className="schedule-date-panel"><div className="calendar-head"><button type="button" aria-label="Previous month" disabled={previousMonthDisabled} onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft size={17} /></button><strong>{new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(month)}</strong><button type="button" aria-label="Next month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight size={17} /></button></div>
        <div className="calendar-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
        <div className="calendar-grid">{days.map((day) => { const itemValue = dateValue(day); const selected = itemValue === selectedDate; const muted = day.getMonth() !== month.getMonth(); const unavailable = preventPast && (itemValue < currentDate || (!dateOnly && itemValue === currentDate && minimumFutureManilaTime(itemValue) === null)); return <button key={itemValue} className={`${selected ? "selected" : ""} ${muted ? "muted" : ""}`} type="button" aria-label={new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric" }).format(day)} aria-pressed={selected} disabled={unavailable} onClick={() => selectDate(itemValue)}>{day.getDate()}</button>; })}</div></div>
      {!dateOnly ? <div className="schedule-time"><TimeControl value={selectedTime} onChange={selectTime} ariaLabel="Start time" minValue={minimumTime} /></div> : null}
      {!dateOnly ? <button className="schedule-done" type="button" onClick={() => setOpen(false)}>Done <Check size={15} /></button> : null}
    </div> : null}
  </div>;
}
