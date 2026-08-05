import { OrganizerPortal } from "@/features/organizer";
export default async function OpenPlayDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OrganizerPortal section="open-play" resourceId={id} />; }
