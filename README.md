# YouTube Creator Investment Platform

유튜브 크리에이터의 성장을 추적하고 가상 투자 게임을 즐길 수 있는 플랫폼입니다.

## 🚀 주요 기능

### Stage 1: 크리에이터 발굴

- 📊 실시간 성장 지표 추적 (구독자, 조회수, 업로드 빈도)
- 🎯 성장 점수 기반 랭킹 시스템
- 🔍 카테고리별 필터링 및 검색
- 📈 30/90일 성장 추이 차트

### Stage 2: 가상 투자 게임

- 💰 초기 자본 10만 포인트 지급
- 📊 실시간 포트폴리오 관리
- 💹 매수/매도 거래 시스템
- 🏆 수익률 기반 리더보드

## 🛠️ 기술 스택

- **Frontend/Backend**: Next.js 14 (App Router) + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Authentication**: NextAuth.js (Google OAuth)
- **Validation**: Zod
- **Charts**: Recharts
- **Styling**: Tailwind CSS

## 📦 설치 및 실행

### 1. 저장소 클론 및 의존성 설치

```bash
cd youtube-creator-investment
npm install
```

### 2. 환경 변수 설정

`.env.local` 파일을 생성하고 다음 값들을 설정하세요:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/youtube_creator_investment"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# YouTube Data API
YOUTUBE_API_KEY="your-youtube-api-key"

# Internal API Secret
CRON_SECRET="your-cron-secret-token"
```

### 3. 데이터베이스 마이그레이션

```bash
npx prisma migrate dev
npx prisma generate
```

### 4. 개발 서버 실행

```bash
npm run dev
```

http://localhost:3000 에서 확인할 수 있습니다.

## 🗄️ 데이터베이스 스키마

### Creator

유튜브 채널 정보 및 현재 지표

- `isActive`: 추적 활성화 여부
- `visibility`: PUBLIC | HIDDEN
- `currentScore`: 성장 점수
- `currentPrice`: 가상 주가

### CreatorStat

일일/시간별 스냅샷

- `period`: DAILY | HOURLY
- 구독자/조회수 변화량 추적

### User

사용자 계정 및 게임 잔고

- `role`: USER | ADMIN
- `balance`: 현재 보유 포인트
- `initialBudget`: 초기 자본

### Position

사용자 보유 포지션

- 수량, 평균 매수가 추적

### Trade

거래 내역

- BUY | SELL 트랜잭션 기록

## 🔧 API 엔드포인트

### Public APIs

- `GET /api/creators` - 크리에이터 리스트 (필터링, 정렬, 페이지네이션)
- `GET /api/creators/[id]` - 크리에이터 상세 정보
- `GET /api/creators/[id]?stats=true&days=30` - 성장 통계
- `GET /api/rankings` - 사용자 랭킹

### Authenticated APIs

- `POST /api/trade/buy` - 매수
- `POST /api/trade/sell` - 매도
- `GET /api/portfolio` - 내 포트폴리오

### Internal APIs

- `POST /api/internal/cron/update-stats` - 크론 작업 (통계 업데이트)

## 📊 성장 점수 계산

```typescript
score =
  0.5 × (30일 구독자 증가율) +
  0.3 × (30일 조회수 증가율) +
  0.2 × (업로드 빈도 점수)

price = max(100, 1000 × score + 100)
```

## 🔐 보안 기능

- ✅ Zod를 통한 입력 검증
- ✅ Rate Limiting (거래 API: 초당 10회)
- ✅ Prisma 트랜잭션으로 원자성 보장
- ✅ NextAuth 세션 기반 인증
- ✅ 크론 엔드포인트 시크릿 토큰 보호

## 🚀 배포

### Vercel 배포

```bash
# Vercel CLI 설치
npm i -g vercel

# 배포
vercel
```

### 환경 변수 설정

Vercel 대시보드에서 모든 환경 변수를 설정하세요.

### 데이터베이스

- Supabase 또는 Railway에서 PostgreSQL 인스턴스 생성
- `DATABASE_URL` 업데이트

### 크론 작업 설정

- cron-job.org 또는 GitHub Actions 사용
- 1시간마다 `/api/internal/cron/update-stats` 호출
- Authorization 헤더에 `CRON_SECRET` 포함

## 📝 초기 데이터 시딩

```typescript
// Prisma Studio로 수동 추가
npx prisma studio

// 또는 시드 스크립트 작성
// prisma/seed.ts
```

20~50명의 크리에이터를 수동으로 추가하여 시작하세요:

- 구독자 범위: 1k~100k (숨은 유망주)
- 카테고리: 게임, 기술, Vlog, 교육 등
- `isActive = true`, `visibility = PUBLIC`

## 🎯 로드맵

- [x] **Phase 1**: 프로젝트 셋업 및 인프라
- [x] **Phase 2**: 데이터베이스 스키마
- [x] **Phase 3**: YouTube API 통합
- [ ] **Phase 4**: 프론트엔드 UI (크리에이터 리스트/상세)
- [x] **Phase 5**: 인증 시스템
- [x] **Phase 6**: 트레이딩 시스템
- [x] **Phase 7**: 포트폴리오 & 랭킹
- [ ] **Phase 8**: 배포 및 최적화

## 🤝 기여

이슈와 PR을 환영합니다!

## 📄 라이선스

MIT License
