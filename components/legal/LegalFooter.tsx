"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const fixedHeightRoutes = new Set(["/", "/dashboard", "/creator"]);

export function LegalFooter() {
  const pathname = usePathname();
  if (fixedHeightRoutes.has(pathname)) return null;

  return (
    <footer className="border-t border-border-exchange bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 text-xs text-muted md:flex-row md:items-center md:justify-between">
        <p>
          크리에이터X는 가상 포인트 기반 크리에이터 성장 예측 게임입니다.
          포인트는 현금 가치가 없으며 현금으로 전환하거나 환급할 수 없습니다.
        </p>
        <nav aria-label="법적 고지" className="flex shrink-0 gap-4">
          <Link href="/terms" className="hover:text-primary">
            이용약관
          </Link>
          <Link href="/privacy" className="hover:text-primary">
            개인정보처리방침
          </Link>
          <Link href="/support" className="hover:text-primary">
            고객지원
          </Link>
        </nav>
      </div>
    </footer>
  );
}
