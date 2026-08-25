import { SectionPage } from "@/features/organizer";
export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <SectionPage section="programs" resourceId={id} />; }
