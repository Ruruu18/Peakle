import { OrganizerPortal } from "@/features/organizer";
export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OrganizerPortal section="programs" resourceId={id} />; }
