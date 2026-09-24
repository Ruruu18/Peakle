import type { Metadata } from "next";
import ResetPasswordScreen from "@/components/reset-password-screen";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Peakle Organizer account.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordScreen />;
}
