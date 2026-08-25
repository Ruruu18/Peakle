import { SectionPage } from "@/features/organizer";

export default async function OpenPlayRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SectionPage section="open-play" resourceId={id} subview="players" />;
}
