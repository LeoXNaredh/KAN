import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { buildAuthUseCases } from "@/lib/auth/composition";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";

export default async function DashboardPage() {
  const user = await getCurrentUserCached();

  const summary = user
    ? await (await buildAuthUseCases()).getDashboardSummary.execute(user.userId).catch(() => undefined)
    : undefined;

  return <DashboardClient summary={summary} />;
}
