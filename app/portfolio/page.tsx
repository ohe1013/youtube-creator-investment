import { PortfolioClient } from "@/components/portfolio/PortfolioClient";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function PortfolioPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/api/auth/signin");
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PortfolioClient />
    </main>
  );
}
