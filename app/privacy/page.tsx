import type { Metadata } from "next";

import { ExternalLink } from "@/components/runtime/ExternalLink";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { readPublicRuntimeConfig } from "@/lib/runtime/config";

export const metadata: Metadata = {
  title: "개인정보처리방침 | 크리에이터X",
};

export default function PrivacyPage() {
  const config = readPublicRuntimeConfig();
  const { legal } = config;

  return (
    <LegalPage
      title="개인정보처리방침"
      summary="크리에이터X가 게임 제공을 위해 처리하는 정보와 이용자의 권리를 안내합니다."
      effectiveDate={legal.effectiveDate}
    >
      <LegalSection title="처리하는 정보">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            가명 게임 식별자: 앱인토스 게임 사용자 식별키 또는 브라우저 계정에
            연결된 내부 식별자
          </li>
          <li>
            세션 데이터: 로그인 또는 게스트 세션 상태, 세션 발급·만료 시각,
            서비스 오류 기록
          </li>
          <li>
            게임 기록: 가상 포인트 잔액, 보유 항목, 주문 및 거래 내역, 취소
            내역
          </li>
        </ul>
        <p>
          크리에이터X는 가상 포인트 게임 제공을 위해 위 정보를 사용하며,
          실명이나 금융계좌 정보를 게임 포인트와 연결하지 않습니다.
        </p>
      </LegalSection>
      <LegalSection title="보유 기간">
        <p>
          정보는 서비스 제공 목적을 달성할 때까지 보유하고, 관계 법령상 보관
          의무가 있는 경우에만 해당 기간 동안 별도로 보관합니다. 샌드박스 데모
          기록은 기기의 앱 저장소에 남으며 앱 데이터 삭제 또는 저장소 초기화
          시 제거됩니다.
        </p>
      </LegalSection>
      <LegalSection title="삭제 요청">
        <p>
          이용자는 지원 채널을 통해 자신의 게임 기록 열람 또는 삭제를 요청할
          수 있습니다. 샌드박스의 기기 로컬 기록은 앱 데이터 삭제로 직접
          초기화할 수도 있습니다.
        </p>
      </LegalSection>
      <LegalSection title="문의처">
        <p>개인정보 문의: {legal.privacyContact}</p>
        <ExternalLink
          href={legal.supportUrl}
          appInToss={config.appInToss}
          className="inline-flex font-semibold text-primary hover:underline"
        >
          개인정보 문의 및 삭제 요청
        </ExternalLink>
      </LegalSection>
    </LegalPage>
  );
}
