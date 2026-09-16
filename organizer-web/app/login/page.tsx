import type { Metadata } from "next";
import LoginScreen from "@/components/login-screen";

export const metadata: Metadata = {
  title: "Organizer sign in",
  description: "Sign in to your Peakle Organizer workspace.",
};

export default function LoginPage() { return <LoginScreen />; }
