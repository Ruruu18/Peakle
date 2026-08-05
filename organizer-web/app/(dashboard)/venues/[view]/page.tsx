import { notFound } from "next/navigation";
import { OrganizerPortal } from "@/features/organizer";
const views = new Set(["pricing", "blackouts", "schedule"]);
export default async function VenueManagementPage({ params }: { params: Promise<{ view: string }> }) { const { view } = await params; if (!views.has(view)) notFound(); return <OrganizerPortal section="venues" subview={view} />; }
