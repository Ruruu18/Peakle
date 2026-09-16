import { buildDemoOrganizerData, updateDemoProgram } from "./demo-data";
import { isDemoModeActive } from "./demo-mode";
import { programCounts, validateProgramDetails, type ProgramDetails } from "./program-utils";
import { requireSupabase } from "./supabase";
import type { Program, ProgramRegistration, ProgramRegistrationStatus } from "./types";

function message(error: { message?: string } | null) {
  if (!error) return;
  if (error.message?.includes("schema cache")) throw new Error("Program management is not available yet. The latest database migration needs to be applied.");
  throw new Error(error.message || "The change could not be saved. Please try again.");
}

function currentDemoProgram(program: Program) {
  const current = buildDemoOrganizerData().programs.find((item) => item.id === program.id);
  if (!current) throw new Error("Program not found.");
  if (current.updated_at !== program.updated_at) throw new Error("This program has changed. Refresh before trying again.");
  return current;
}

export async function saveProgramDetails(program: Program, details: ProgramDetails) {
  const error = validateProgramDetails(details, programCounts(program).registered);
  if (error) throw new Error(error);
  if (isDemoModeActive()) {
    currentDemoProgram(program);
    updateDemoProgram(program.id, details);
    return;
  }
  const result = await requireSupabase().rpc("update_venue_program_details", {
    p_program_id: program.id, p_expected_updated_at: program.updated_at,
    p_name: details.name.trim(), p_kind: details.kind, p_skill_division: details.skill_division,
    p_starts_at: details.starts_at, p_ends_at: details.ends_at, p_capacity: details.capacity,
    p_price: details.price, p_description: details.description?.trim() || null,
  });
  message(result.error);
}

export async function setProgramStatus(program: Program, status: "open" | "closed" | "cancelled") {
  if (isDemoModeActive()) {
    currentDemoProgram(program);
    updateDemoProgram(program.id, { registration_status: status });
    return;
  }
  const result = await requireSupabase().rpc("set_venue_program_status", { p_program_id: program.id, p_status: status, p_expected_updated_at: program.updated_at });
  message(result.error);
}

export async function setProgramParticipantStatus(program: Program, registration: ProgramRegistration, status: ProgramRegistrationStatus) {
  if (isDemoModeActive()) {
    const current = currentDemoProgram(program);
    if (status === "registered" && !["registered", "attended"].includes(registration.status) && !programCounts(current).available) throw new Error("This program is full. Increase capacity before admitting another player.");
    updateDemoProgram(program.id, { program_registrations: current.program_registrations?.map((item) => item.user_id === registration.user_id ? { ...item, status, checked_in_at: status === "attended" ? new Date().toISOString() : null } : item) });
    return;
  }
  const result = await requireSupabase().rpc("update_program_participant", { p_program_id: program.id, p_user_id: registration.user_id, p_status: status, p_expected_status: registration.status });
  message(result.error);
}
