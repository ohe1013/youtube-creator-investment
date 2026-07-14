# CreatorX 비공개 Toss 출시 핸드오프

이 문서는 CreatorX를 **비공개 테스트**까지 넘기기 위한 운영 절차다. 로컬 빌드 성공만으로 검토 요청이나 공개 출시를 완료로 표시하지 않는다. 실제 Console, 자격증명, 실기기 테스트는 소유자만 수행하는 외부 게이트다.

## 공식 기준

- [토스앱 테스트하기](https://developers-apps-in-toss.toss.im/development/test/toss.html)
- [미니앱 출시](https://developers-apps-in-toss.toss.im/development/deploy.html)

공식 정책은 압축 해제 기준 앱 번들 100MB 이하, 비공개 테스트 최소 1회 완료 후 검토 요청, 승인 후 별도의 공개 출시 동작이다. 이 저장소의 `npm run verify:artifact`는 더 보수적으로 100MiB **미만**을 강제하므로, 그 명령이 통과하지 않으면 업로드하지 않는다.

## 소유자와 비밀값 경계

다음은 코드 작업자가 만들거나 입력하지 않는다.

| 소유자 작업 | 안전한 처리 방식 |
| --- | --- |
| Vercel 프로젝트와 Production 환경 변수 | 소유자 대시보드 또는 승인된 비밀 관리 도구에서만 입력 |
| Supabase 운영 DB와 URL | 소유자 대시보드에서만 연결; 테스트가 운영 DB를 가리키지 않게 유지 |
| Toss Business 워크스페이스, Console API 키, 번들 업로드 | 로그인한 소유자가 Console 또는 자신의 안전한 CI에서 수행 |
| Toss Login mTLS 인증서/개인키 | Toss Login을 켤 때만 소유자가 발급·등록 |

데이터베이스 URL, API 키, 토큰, 인증서, 개인키, 쿠키를 채팅·Git·`.env*`·PowerShell 기록·스크린샷·`creatorx.ait`·증적 파일에 넣지 않는다. 값 자체를 요구하지 말고, 설정 완료 여부와 비밀이 아닌 결과만 기록한다.

Vercel에서는 시스템 환경 변수 `VERCEL_ENV`를 빌드 환경에 명시적으로 노출해야 한다. 현재 빌드 게이트는 정확히 `production`일 때만 preflight 후 build를 실행하며, `preview`/`development`만 build를 실행한다. 값이 없거나 그 외 값이면 build를 시작하지 않고 실패한다.

## 1. 운영 값으로 로컬·서버 게이트 실행

승인된 Production 값이 신뢰할 수 있는 세션 또는 비밀 관리 도구를 통해 준비된 뒤에만 아래 순서를 실행한다. 값 대입 명령을 문서, 터미널 기록, CI 로그에 남기지 않는다. `test:integration`은 운영 DB가 아닌 격리된 테스트 DB만 사용해야 한다.

```powershell
nvm use 24.18.0
npm ci
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run production:preflight
npm run build:appintoss:production
npm run build:ait
npm run verify:artifact
npm run scan:client-secrets
```

모든 명령은 exit code `0`이어야 한다. `npm run build:ait`는 이 저장소의 `ait build` 래퍼이며 루트에 `creatorx.ait`를 만든다. 공식 CLI의 동등한 명령은 `npx ait build`이지만, 같은 릴리스에 두 빌드를 연속 실행하지 말고 저장소 래퍼 하나만 사용한다. `npm run verify:artifact`의 JSON에서 `uncompressedBytes`와 `maxBytes`를 확인하고, `creatorx.ait`의 압축 해제 크기가 100MiB 미만인지 확인한다. preflight·secret scan·artifact 검증 중 하나라도 실패하면 업로드·검토 요청을 중단한다.

## 2. 배포된 API health와 정확한 CORS 확인

승인된 HTTPS 운영 API만 사용한다. HTTP URL, 와일드카드 CORS, 임의의 개발 origin은 출시 조건이 아니다.

```powershell
$apiOrigin = "https://<approved-production-api-origin>"
curl.exe -fsS "$apiOrigin/api/health"
```

응답은 `status: "ok"`와 비밀이 아닌 revision만 보여야 한다. 이어서 `/api/health`의 OPTIONS 요청을 검사한다.

```powershell
$allowedOrigins = @(
  "https://creatorx.private-apps.tossmini.com",
  "https://creatorx.apps.tossmini.com"
)

foreach ($origin in $allowedOrigins) {
  curl.exe -sS -D - -o NUL -X OPTIONS "$apiOrigin/api/health" `
    -H "Origin: $origin" `
    -H "Access-Control-Request-Method: GET"
}

$unknownOrigin = "https://not-creatorx.example"
curl.exe -sS -i -X OPTIONS "$apiOrigin/api/health" `
  -H "Origin: $unknownOrigin" `
  -H "Access-Control-Request-Method: GET"
```

각 허용 origin은 `204`와 자기 자신과 정확히 같은 `access-control-allow-origin`을 받아야 하며 `*`는 허용되지 않는다. unknown origin은 `403`/`CORS_ORIGIN_DENIED`이고 CORS 허용 헤더가 없어야 한다. 결과가 다르면 Vercel 환경 또는 API CORS 설정을 고친 뒤 처음부터 확인한다.

## 3. `.ait` 업로드와 비공개 테스트 링크

`creatorx.ait`와 검증 결과가 준비된 뒤에만 다음 둘 중 하나를 선택한다.

1. **Console 수동 업로드:** Toss Console에서 워크스페이스 → `creatorx` 앱 → 앱 출시로 이동해 `.ait`를 업로드한다. 테스트하기에서 QR 코드와 테스트 스킴을 확인한다.
2. **소유자 CI/CLI 업로드:** API 키를 명령행 인수나 로그에 넣지 말고, 대화형으로 소유자 계정에만 토큰을 등록한 뒤 배포한다.

   ```powershell
   npx ait token add
   npx ait deploy -m "<non-secret release note>"
   ```

업로드가 생성한 deployment ID를 받아 다음 형식의 링크를 사용한다.

```text
intoss-private://creatorx?_deploymentId=<id>
```

`_deploymentId`는 비공개 테스트에서 필수다. 테스트자는 모두 다음 조건을 충족해야 한다.

- Toss 앱에 로그인되어 있다.
- 해당 Toss 워크스페이스의 멤버다.
- 만 19세 이상이다.

검토 요청 전에는 소비자 Toss 앱에서 이 비공개 흐름을 최소 한 번 끝까지 테스트한다. 이 조건을 충족해도 검토 요청과 공개 출시는 별도 Console 동작이다. 테스트가 끝났다고 공개 출시 버튼을 누르지 않는다.

## 4. 비공개 소비자 Toss 스모크 체크리스트

테스트 스킴/QR을 실제 소비자 Toss 앱에서 열고 아래를 체크한다. 실패하면 deployment ID, 안전한 오류 요약, 시각만 남기고 수정·재업로드·재테스트한다.

- [ ] 로그인: 사용 가능한 방식으로 로그인하고 세션이 안전하게 생성된다.
- [ ] 크리에이터 목록과 상세: 목록 로드, 상세 이동, 뒤로가기가 정상이다.
- [ ] 주문: 매수/매도 입력과 서버 응답이 정상이며 값이 중복 처리되지 않는다.
- [ ] 새로고침: 동시 새로고침에서도 목록·잔고·주문 상태가 일관된다.
- [ ] 포트폴리오와 취소: 보유 현황을 확인하고 취소 가능한 주문을 취소한다.
- [ ] 뒤로/루트: 뒤로가기는 화면 전환, 루트에서는 예상된 닫기 동작을 한다.
- [ ] 외부 링크: 외부 링크가 의도한 방식으로 열리고 앱 상태가 깨지지 않는다.
- [ ] 재시작: 앱을 종료·재진입해 세션/화면 복원이 안전한지 확인한다.
- [ ] 네트워크: 오프라인·복구 시 사용자에게 안전한 실패/재시도 상태가 보인다.
- [ ] 공동 테스트: 가능하면 두 번째 권한 있는 워크스페이스 멤버가 동일 상태를 확인한다.

## 5. 비밀 없는 증적 인덱스

`docs/release-evidence/`에는 비밀이 아닌 인덱스만 보관한다. 운영자가 실제 테스트를 마친 뒤 날짜별 Markdown 파일을 만들고 다음 항목을 채운다.

| 항목 | 기록할 값 | 기록하지 않을 값 |
| --- | --- | --- |
| Deployment ID | Console/CLI가 반환한 ID | Console API 키·토큰 |
| Artifact SHA-256 | `Get-FileHash .\creatorx.ait -Algorithm SHA256`의 Hash | 아티팩트 내부의 설정·비밀 |
| Server revision | `/api/health`의 revision | 환경 변수·DB URL |
| Timestamp | UTC ISO-8601 시각 | 계정/세션 정보 |
| 결과 | 각 게이트와 스모크의 PASS/FAIL | 사용자 개인정보·스크린샷의 민감 정보 |

권장 템플릿:

```markdown
| Gate | Result | Safe evidence |
| --- | --- | --- |
| deployment ID | PASS/FAIL | `<id or pending>` |
| artifact SHA-256 | PASS/FAIL | `<sha256 or pending>` |
| server revision | PASS/FAIL | `<revision or pending>` |
| private Toss smoke | PASS/FAIL | `<UTC timestamp and safe summary>` |
```

## 6. 다음 외부 게이트

이 저장소의 문서는 Console, Production 자격증명, Toss Business 검증, mTLS 발급, 실제 디바이스 테스트를 대체하지 않는다. 실제 Production 값·Console 업로드·소비자 Toss 테스트가 아직 없으면 출시 준비 상태는 **외부 게이트로 차단됨**이다. 소유자가 준비를 마치면 이 문서의 1단계부터 재개하고, 비공개 테스트와 증적을 확인한 다음에만 Console에서 검토 요청을 검토한다.
