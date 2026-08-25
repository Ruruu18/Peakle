"use client";

import { createContext, useContext } from "react";
import type { OrganizerData, Venue } from "@/lib/types";
import type { PortalSection } from "@/lib/portal-sections";
import type { CreateType } from "./dialogs/create-activity-dialog";
import { SectionContent } from "./sections/section-content";

type OrganizerWorkspaceContextValue = {
  data: OrganizerData;
  venue: Venue | null;
  venueId: string | null;
  onVenueChange: (venueId: string | null) => void;
  navigate: (section: PortalSection) => void;
  refresh: () => Promise<void>;
  onCreate: (type: CreateType) => void;
};

const OrganizerWorkspaceContext = createContext<OrganizerWorkspaceContextValue | null>(null);

export function OrganizerWorkspaceProvider({ value, children }: { value: OrganizerWorkspaceContextValue; children: React.ReactNode }) {
  return <OrganizerWorkspaceContext.Provider value={value}>{children}</OrganizerWorkspaceContext.Provider>;
}

export function useOrganizerWorkspaceContext() {
  const ctx = useContext(OrganizerWorkspaceContext);
  if (!ctx) throw new Error("useOrganizerWorkspaceContext must be used within the organizer dashboard layout");
  return ctx;
}

export function SectionPage({ section, resourceId, subview }: { section: PortalSection; resourceId?: string; subview?: string }) {
  const { data, venue, venueId, onVenueChange, navigate, refresh, onCreate } = useOrganizerWorkspaceContext();
  return <SectionContent section={section} data={data} venue={venue} venueId={venueId} onVenueChange={onVenueChange} navigate={navigate} refresh={refresh} onCreate={onCreate} resourceId={resourceId} subview={subview} />;
}
