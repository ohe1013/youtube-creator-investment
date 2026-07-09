import { CreatorDetailClient } from "@/components/creator/CreatorDetailClient";
import { appInTossDemoData } from "@/lib/appintoss-demo-data";

export function generateStaticParams() {
  if (process.env.APP_IN_TOSS !== "1") {
    return [];
  }

  return appInTossDemoData.creators.map((creator) => ({ id: creator.id }));
}

export default async function CreatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <CreatorDetailClient id={id} />;
}
