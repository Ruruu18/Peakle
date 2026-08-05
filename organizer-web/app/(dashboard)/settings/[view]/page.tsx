import { notFound } from "next/navigation";
import { OrganizerPortal } from "@/features/organizer";
const views = new Set(["profile", "notifications", "security", "player-app"]);
export default async function AccountSettingsPage({ params }: { params: Promise<{ view: string }> }) { const { view } = await params; if (!views.has(view)) notFound(); return <OrganizerPortal section="settings" subview={view} />; }
