"use client";

import Link from "next/link";
import type { OrganizerData, Venue } from "@/lib/types";
import type { CreateType } from "../dialogs/create-activity-dialog";
import { CompetitionCard, Empty, Status, dateOnly, titleCase } from "../components/portal-ui";
import { CompetitionMonitor } from "./competition-monitor";

export function CompetitionsSection({ data, venue, onCreate, resourceId, subview }: { data: OrganizerData; venue: Venue | null; onCreate: (type: CreateType) => void; resourceId?: string; subview?: string }) {
  const competitions = data.competitions;
  if (resourceId) {
    const competition = competitions.find((item) => item.id === resourceId);
    if (!competition) return <Empty title="Competition not found" detail="This competition may have been removed or belongs to another venue." />;
    if (subview === "monitor") {
      const venueCompetitions = competitions.filter((item) => !venue || item.venue_id === venue.id);
      return <CompetitionMonitor competitions={venueCompetitions} competitionId={resourceId} />;
    }
    const entries = competition.competition_divisions?.flatMap((division) => division.competition_entries || []).length || 0;
    return <div className="management-grid"><div className="card management-card"><div className="card-topline"><span className="card-kicker">{titleCase(competition.kind)}</span><Status value={competition.status || "registration"} /></div><h2>{competition.name}</h2><p>{dateOnly(competition.starts_on)} · {competition.competition_divisions?.length || 0} divisions</p><div className="venue-facts"><div><strong>{entries}</strong><small>ENTRIES</small></div><div><strong>{competition.competition_divisions?.length || 0}</strong><small>DIVISIONS</small></div></div><div className="management-actions"><Link className="button button-accent inline-action" href={`/monitor?competition=${competition.id}`}>Open in Live Monitor</Link><Link className="button button-ghost inline-action" href="/competitions">Back to competitions</Link></div></div></div>;
  }
  const venueCompetitions = competitions.filter((item) => !venue || item.venue_id === venue.id);
  return venueCompetitions.length ? <div className="program-grid">{venueCompetitions.map((competition) => <CompetitionCard key={competition.id} competition={competition} />)}</div> : <Empty title="No competition yet" detail="Open registration for a tournament, ladder, league, or club season." action="Create competition" onAction={() => onCreate("competition")} />;
}
