"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { CreatorDetailClient } from "@/components/creator/CreatorDetailClient";

function CreatorRoute() {
  const id = useSearchParams().get("id");
  return id ? (
    <CreatorDetailClient key={id} id={id} />
  ) : (
    <p role="alert">크리에이터를 선택해 주세요.</p>
  );
}

export default function CreatorPage() {
  return (
    <Suspense fallback={<p>불러오는 중...</p>}>
      <CreatorRoute />
    </Suspense>
  );
}
