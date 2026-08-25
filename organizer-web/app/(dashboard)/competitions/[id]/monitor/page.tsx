import { redirect } from "next/navigation";

export default async function CompetitionMonitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/monitor?competition=${id}`);
}
