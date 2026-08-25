import { notFound } from "next/navigation";
import { SectionPage } from "@/features/organizer";
const views = new Set(["pricing", "blackouts", "schedule"]);
export default async function VenueManagementPage({ params }: { params: Promise<{ view: string }> }) { const { view } = await params; if (!views.has(view)) notFound(); return <SectionPage section="venues" subview={view} />; }
