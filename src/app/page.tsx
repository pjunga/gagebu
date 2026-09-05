import AuthGate from "@/components/auth-gate";
import GagebuDashboard from "@/components/gagebu-dashboard";

export default function Home() {
  return (
    <AuthGate>
      <GagebuDashboard />
    </AuthGate>
  );
}
