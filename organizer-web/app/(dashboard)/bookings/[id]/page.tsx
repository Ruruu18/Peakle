import { SectionPage } from "@/features/organizer";
export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <SectionPage section="bookings" resourceId={id} />; }
