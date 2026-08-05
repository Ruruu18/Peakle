import { OrganizerPortal } from "@/features/organizer";
export default async function CompetitionDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OrganizerPortal section="competitions" resourceId={id} />; }
