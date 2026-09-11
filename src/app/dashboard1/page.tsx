import type { Metadata } from "next";
import { Dashboard1Experience } from "@/components/dashboard1/dashboard1-experience";

export const metadata: Metadata = {
  title: "Dashboard — conceito horizontal",
  description: "Conceito alternativo do dashboard Prosperity Pay com navegação horizontal.",
};

export default function Dashboard1Page() {
  return <Dashboard1Experience />;
}
