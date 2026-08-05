"use client";

import Link from "next/link";
import type { OrganizerData, Venue } from "@/lib/types";
import type { CreateType } from "../dialogs/create-activity-dialog";
import { Empty, ProgramCard, Status, dateTime, money, titleCase } from "../components/portal-ui";

export function ProgramsSection({ data, venue, onCreate, resourceId }: { data: OrganizerData; venue: Venue | null; onCreate: (type: CreateType) => void; resourceId?: string }) {
  if (resourceId) {
    const program = data.programs.find((item) => item.id === resourceId);
    if (!program) return <Empty title="Program not found" detail="This program may have been removed or belongs to another venue." />;
    return <div className="management-grid"><div className="card management-card"><div className="card-topline"><span className="card-kicker">{titleCase(program.kind)}</span><Status value={program.registration_status || "open"} /></div><h2>{program.name}</h2><p>{dateTime(program.starts_at)} · {money(program.price)} per player</p><div className="venue-facts"><div><strong>{program.program_registrations?.length || 0}</strong><small>REGISTERED</small></div><div><strong>{program.capacity || "—"}</strong><small>CAPACITY</small></div></div><Link className="button button-ghost inline-action" href="/programs">Back to programs</Link></div></div>;
  }
  const programs = data.programs.filter((item) => !venue || item.venue_id === venue.id);
  return programs.length ? <div className="program-grid">{programs.map((program) => <ProgramCard key={program.id} program={program} />)}</div> : <Empty title="No programs yet" detail="Publish clinics, coaching, camps, or recurring training for your players." action="Create program" onAction={() => onCreate("program")} />;
}
