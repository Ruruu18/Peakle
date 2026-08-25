import { OrganizerShell } from "@/features/organizer";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <OrganizerShell>{children}</OrganizerShell>;
}
