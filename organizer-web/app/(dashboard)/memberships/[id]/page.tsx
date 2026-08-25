import { SectionPage } from "@/features/organizer";
export default async function MembershipDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <SectionPage section="memberships" resourceId={id} />; }
