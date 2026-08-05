import { OrganizerPortal } from "@/features/organizer";

export default async function OpenPlayRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganizerPortal section="open-play" resourceId={id} subview="players" />;
}
