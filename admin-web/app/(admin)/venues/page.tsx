import type { Metadata } from "next";
import VenuesSection from "@/features/admin/sections/venues-section";

export const metadata: Metadata = { title: "Venues" };

export default function VenuesPage() {
  return <VenuesSection />;
}
