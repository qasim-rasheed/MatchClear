import { getDatabase } from "@/server/db";
import { seedDatabase } from "@/server/db/seed";
import { getWorkspace, WorkspaceError } from "@/server/workspace";
import { notFound } from "next/navigation";
import { WorkspaceApp } from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; tab?: string }>;
}) {
  const ctx = getDatabase();
  seedDatabase(ctx);
  const params = await searchParams;
  try {
    return <WorkspaceApp initial={getWorkspace(ctx, params.event)} initialTab={params.tab} />;
  } catch (error) {
    if (error instanceof WorkspaceError && error.status === 404) notFound();
    throw error;
  }
}
