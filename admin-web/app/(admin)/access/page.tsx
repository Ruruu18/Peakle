import type { Metadata } from "next";
import AccessSection from "@/features/admin/sections/access-section";

export const metadata: Metadata = { title: "Access" };

export default function AccessPage() {
  return <AccessSection />;
}
