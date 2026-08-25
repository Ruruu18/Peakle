import type { Metadata } from "next";
import RegisterScreen from "@/components/register-screen";

export const metadata: Metadata = {
  title: "Create organizer account",
  description: "Create a Peakle account for organizer tools on web and mobile.",
};

export default function RegisterPage() {
  return <RegisterScreen />;
}
