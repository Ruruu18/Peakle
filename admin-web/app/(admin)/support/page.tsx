import type { Metadata } from "next";
import SupportSection from "@/features/admin/sections/support-section";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return <SupportSection />;
}
