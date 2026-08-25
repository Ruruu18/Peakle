import type { Metadata } from "next";
import DashboardSection from "@/features/admin/sections/dashboard-section";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <DashboardSection />;
}
