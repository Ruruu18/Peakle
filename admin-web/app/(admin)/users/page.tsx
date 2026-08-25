import type { Metadata } from "next";
import UsersSection from "@/features/admin/sections/users-section";

export const metadata: Metadata = { title: "Users" };

export default function UsersPage() {
  return <UsersSection />;
}
