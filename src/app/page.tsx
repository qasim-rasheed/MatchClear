import { getDatabase } from "@/server/db";
import { seedDatabase } from "@/server/db/seed";
import { getWorkspace } from "@/server/workspace";
import { WorkspaceApp } from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const ctx = getDatabase();
  seedDatabase(ctx);
  const params = await searchParams;
  return <WorkspaceApp initial={getWorkspace(ctx, params.event)} />;
}
