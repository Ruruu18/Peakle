import type { Metadata } from "next";
import FinancialsSection from "@/features/admin/sections/financials-section";

export const metadata: Metadata = { title: "Financials" };

export default function FinancialsPage() {
  return <FinancialsSection />;
}
