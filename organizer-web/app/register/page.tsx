import type { Metadata } from "next";
import RegisterScreen from "@/components/register-screen";
import { organizerRegisterDescription, organizerRegisterTitle } from "@/lib/launch-offer";

export const metadata: Metadata = {
  title: organizerRegisterTitle,
  description: organizerRegisterDescription,
};

export default function RegisterPage() {
  return <RegisterScreen />;
}
