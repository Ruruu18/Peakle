"use client";

import type { OrganizerData, Venue } from "@/lib/types";
import type { PortalSection } from "@/lib/portal-sections";
import type { CreateType } from "../dialogs/create-activity-dialog";
import { AnalyticsSection } from "./analytics-section";
import { CompetitionsSection } from "./competitions-section";
import { MembershipsSection } from "./memberships-section";
import { MonitorSection } from "./monitor-section";
import { OpenPlaySection } from "./open-play-section";
import { OverviewSection } from "./overview-section";
import { PlayersSection } from "./players-section";
import { ProgramsSection } from "./programs-section";
import { SettingsSection } from "./settings-section";
import { StaffSection } from "./staff-section";
import { VenuesSection } from "./venues-section";

export function SectionContent({ section, data, venue, venueId, onVenueChange, navigate, refresh, onCreate, resourceId, subview }: { section: PortalSection; data: OrganizerData; venue: Venue | null; venueId: string | null; onVenueChange: (venueId: string | null) => void; navigate: (section: PortalSection) => void; refresh: () => Promise<void>; onCreate: (type: CreateType) => void; resourceId?: string; subview?: string }) {
  if (section === "overview") return <OverviewSection data={data} venue={venue} navigate={navigate} onCreate={onCreate} />;
  if (section === "open-play") return <OpenPlaySection data={data} onCreate={onCreate} refresh={refresh} resourceId={resourceId} subview={subview} />;
  if (section === "monitor") return <MonitorSection data={data} venueId={venueId} onVenueChange={onVenueChange} refresh={refresh} />;
  if (section === "players") return <PlayersSection data={data} refresh={refresh} />;
  if (section === "venues") return <VenuesSection venue={venue} refresh={refresh} subview={subview} />;
  if (section === "programs") return <ProgramsSection data={data} venue={venue} onCreate={onCreate} resourceId={resourceId} />;
  if (section === "competitions") return <CompetitionsSection data={data} venue={venue} onCreate={onCreate} resourceId={resourceId} />;
  if (section === "memberships") return <MembershipsSection data={data} venue={venue} onCreate={onCreate} resourceId={resourceId} />;
  if (section === "analytics") return <AnalyticsSection data={data} />;
  if (section === "staff") return <StaffSection data={data} venue={venue} refresh={refresh} subview={subview} />;
  return <SettingsSection data={data} subview={subview} refresh={refresh} />;
}
