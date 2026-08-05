import { OrganizerPortal } from "@/features/organizer";
export default async function MembershipDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OrganizerPortal section="memberships" resourceId={id} />; }
