import type { Metadata } from "next";
import GagebuDashboard from "@/components/gagebu-dashboard";

// Unlisted test page: dummy data in memory, no login, nothing persisted.
export const metadata: Metadata = {
  title: "가계부 · 데모",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <GagebuDashboard demo />;
}
