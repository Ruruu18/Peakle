import { LayoutDashboard, Users, Building2, ShieldCheck, CircleDollarSign, LifeBuoy } from "lucide-react";

export const adminNavigation = [
  { section: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { section: "users", label: "Users", icon: Users },
  { section: "venues", label: "Venues", icon: Building2 },
  { section: "financials", label: "Financials", icon: CircleDollarSign },
  { section: "support", label: "Support", icon: LifeBuoy },
  { section: "access", label: "Access", icon: ShieldCheck },
] as const;

export type AdminSection = typeof adminNavigation[number]["section"];
