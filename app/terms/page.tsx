import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { readPublicRuntimeConfig } from "@/lib/runtime/config";

export const metadata: Metadata = {
  title: "이용약관 | 크리에이터X",
};

export default function TermsPage() {
  const { legal } = readPublicRuntimeConfig();

  return (
    <LegalPage
      title="이용약관"
      summary="크리에이터X 이용 조건과 가상 포인트 게임 규칙을 안내합니다."
      effectiveDate={legal.effectiveDate}
    >
      <LegalSection title="서비스 성격">
        <p>
          크리에이터X는 가상 포인트 기반 크리에이터 성장 예측 게임입니다.
          실제 금융상품을 매매하거나 중개하는 서비스가 아닙니다.
        </p>
      </LegalSection>
      <LegalSection title="포인트와 거래">
        <p>
          게임 안의 잔액, 가격 및 거래는 모두 가상이며 현금 가치가 없습니다.
          포인트를 현금으로 전환하거나 환급할 수 없고, 다른 사람에게 현금
          대가로 양도할 수도 없습니다.
        </p>
        <p>
          화면의 가격, 순위, 성장률 및 손익 표시는 게임 진행을 위한 예측
          정보입니다. 실제 투자 상품이 아니며 수익을 보장하지 않습니다.
        </p>
      </LegalSection>
      <LegalSection title="이용자의 책임">
        <p>
          이용자는 게임 규칙을 준수해야 하며, 비정상적인 자동화나 서비스
          운영을 방해하는 행위를 해서는 안 됩니다. 데모 데이터와 게임 결과를
          실제 투자 판단에 사용해서는 안 됩니다.
        </p>
      </LegalSection>
      <LegalSection title="운영 및 문의">
        <p>운영 주체: {legal.operatorName}</p>
        <p>
          약관 또는 서비스 문의는 고객지원 페이지에 표시된 지원 채널로 접수할
          수 있습니다.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
