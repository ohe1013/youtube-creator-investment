import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { ExternalLink } from "@/components/runtime/ExternalLink";
import { readPublicRuntimeConfig } from "@/lib/runtime/config";

export const metadata: Metadata = {
  title: "고객지원 | 크리에이터X",
};

export default function SupportPage() {
  const config = readPublicRuntimeConfig();
  const { legal } = config;

  return (
    <LegalPage
      title="고객지원"
      summary="게임 이용, 개인정보, 데이터 삭제 및 오류를 지원 채널로 접수할 수 있습니다."
      effectiveDate={legal.effectiveDate}
    >
      <LegalSection title="운영 정보">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="font-semibold text-foreground">운영 주체</dt>
          <dd>{legal.operatorName}</dd>
          <dt className="font-semibold text-foreground">개인정보 문의</dt>
          <dd>{legal.privacyContact}</dd>
          <dt className="font-semibold text-foreground">시행일</dt>
          <dd>{legal.effectiveDate}</dd>
        </dl>
      </LegalSection>
      <LegalSection title="지원 요청">
        {config.releaseChannel === "production" ? (
          <p>
            운영 환경의 지원 채널로 문제 화면, 재현 순서, 사용 환경을 함께
            보내주세요. 개인 식별키나 비밀값은 포함하지 마세요.
          </p>
        ) : (
          <p>
            샌드박스 단계의 지원 채널은 저장소 이슈 트래커입니다. 문제 화면,
            재현 순서, 사용 환경을 함께 남기고 개인 식별키나 비밀값은 게시하지
            마세요.
          </p>
        )}
        <ExternalLink
          href={legal.supportUrl}
          appInToss={config.appInToss}
          className="inline-flex rounded-lg bg-primary px-4 py-2 font-bold text-background"
        >
          지원 요청 열기
        </ExternalLink>
      </LegalSection>
      <LegalSection title="가상 포인트 안내">
        <p>
          모든 포인트와 거래는 게임 전용이며 현금 가치가 없고 현금으로 전환하거나
          환급할 수 없습니다. 크리에이터X는 실제 투자 상품이나 수익 보장
          서비스를 제공하지 않습니다.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
