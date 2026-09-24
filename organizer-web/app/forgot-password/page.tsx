import type { Metadata } from "next";
import ForgotPasswordScreen from "@/components/forgot-password-screen";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your Peakle Organizer account.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
