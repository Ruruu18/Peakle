import assert from "node:assert/strict";
import test from "node:test";
import { canManagePrograms, programCounts, programInputDate, programPhase, validateProgramDetails } from "../lib/program-utils.ts";

test("capacity includes registered and attended players, excluding waitlist and history", () => {
  const program = { capacity: 3, program_registrations: ["registered", "attended", "waitlisted", "cancelled", "no_show"].map((status) => ({ status })) };
  assert.deepEqual(programCounts(program), { registered: 2, attended: 1, waitlisted: 1, available: 1 });
  assert.equal(programCounts({ ...program, capacity: 1 }).available, 0);
  assert.equal(programCounts({ capacity: 16 }).available, 16);
});

test("cancelled and completed programs do not display as open", () => {
  const now = Date.parse("2026-09-07T10:00:00Z");
  const program = { starts_at: "2026-09-07T09:00:00Z", ends_at: "2026-09-07T10:00:00Z", registration_status: "open" };
  assert.equal(programPhase(program, now), "completed");
  assert.equal(programPhase({ ...program, registration_status: "cancelled" }, now), "cancelled");
  assert.equal(programPhase({ ...program, ends_at: "2026-09-07T11:00:00Z" }, now), "in_progress");
  assert.equal(programPhase({ ...program, starts_at: "2026-09-08T09:00:00Z", ends_at: "2026-09-08T11:00:00Z" }, now), "open");
});

test("edit inputs use Philippine time across UTC date boundaries", () => {
  assert.equal(programInputDate("2026-09-07T20:30:00Z"), "2026-09-08T04:30");
  assert.equal(programInputDate(null), "");
});

const valid = { name: "Beginner clinic", kind: "clinic", skill_division: "beginner", starts_at: "2026-09-08T09:00:00+08:00", ends_at: "2026-09-08T11:00:00+08:00", capacity: 16, price: 0 };
test("program validation protects enrolled places and matches database limits", () => {
  assert.equal(validateProgramDetails(valid, 16), null);
  assert.match(validateProgramDetails({ ...valid, capacity: 15 }, 16), /below/);
  for (const capacity of [0, 201, 1.5, NaN]) assert.match(validateProgramDetails({ ...valid, capacity }, 0), /whole number/);
  assert.match(validateProgramDetails({ ...valid, name: "  ab  " }, 0), /name/);
  assert.match(validateProgramDetails({ ...valid, ends_at: valid.starts_at }, 0), /end time/);
  assert.match(validateProgramDetails({ ...valid, starts_at: "invalid" }, 0), /end time/);
  for (const price of [-1, NaN, Infinity, 100000000]) assert.match(validateProgramDetails({ ...valid, price }, 0), /price/);
});

test("management controls are limited to venue managers and admins", () => {
  for (const role of ["owner", "manager", "admin"]) assert.equal(canManagePrograms({ role }), true);
  for (const role of ["viewer", "front_desk", "scorer", "court_monitor"]) assert.equal(canManagePrograms({ role }), false);
  assert.equal(canManagePrograms(null), false);
});
