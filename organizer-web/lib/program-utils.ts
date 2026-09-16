import type { Program, Venue } from "./types";

export function canManagePrograms(venue: Venue | null) {
  return Boolean(venue && ["owner", "manager", "admin"].includes(venue.role));
}

export function programCounts(program: Program) {
  const registrations = program.program_registrations ?? [];
  const registered = registrations.filter((item) => ["registered", "attended"].includes(item.status)).length;
  return {
    registered,
    waitlisted: registrations.filter((item) => item.status === "waitlisted").length,
    attended: registrations.filter((item) => item.status === "attended").length,
    available: Math.max(0, (program.capacity ?? 0) - registered),
  };
}

export function programPhase(program: Program, now = Date.now()) {
  if (program.registration_status === "cancelled") return "cancelled";
  if (program.ends_at && new Date(program.ends_at).getTime() <= now) return "completed";
  if (program.starts_at && new Date(program.starts_at).getTime() <= now) return "in_progress";
  return program.registration_status || "draft";
}

export function programDateTime(value?: string | null) {
  return value ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Schedule pending";
}

export function programPrice(value?: number | null) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
}

export function programInputDate(value?: string | null) {
  if (!value) return "";
  return new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16);
}

export type ProgramDetails = Pick<Program, "name" | "kind" | "skill_division" | "starts_at" | "ends_at" | "capacity" | "price" | "description">;

export function validateProgramDetails(details: ProgramDetails, registered: number) {
  if (details.name.trim().length < 3 || details.name.trim().length > 100) return "Use a program name between 3 and 100 characters.";
  if (!["clinic", "coaching", "camp", "open_play"].includes(details.kind || "")) return "Choose a valid program type.";
  if (!["all", "beginner", "intermediate", "advanced"].includes(details.skill_division || "")) return "Choose a valid skill level.";
  const start = new Date(details.starts_at || "").getTime();
  const end = new Date(details.ends_at || "").getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "The end time must be after the start time.";
  if (!Number.isInteger(details.capacity) || details.capacity! < 1 || details.capacity! > 200) return "Capacity must be a whole number between 1 and 200.";
  if (details.capacity! < registered) return `Capacity cannot be below the ${registered} registered players.`;
  if (details.price == null || !Number.isFinite(details.price) || details.price < 0 || details.price > 99999999.99) return "Enter a valid price of zero or more.";
  return null;
}
