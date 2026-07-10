"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCreatorXSession } from "@/lib/session/CreatorXSessionProvider";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useCreatorXSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-2xl">로딩 중...</div>
      </div>
    );
  }

  return <>{children}</>;
}
