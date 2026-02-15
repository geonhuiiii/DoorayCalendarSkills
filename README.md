# Dooray Calendar Sync

Dooray, Apple, Google 캘린더를 통합 동기화하는 OpenClaw 스킬입니다.

## 동기화 규칙

| 원본 | 대상 | 가시성 | 설명 |
|------|------|--------|------|
| **Dooray** | Apple, Google | 공개 | 제목, 내용, 장소가 모두 보입니다 |
| **Apple** | Dooray, Google | 비공개 | 나만 볼 수 있고, 다른 사람에겐 "바쁨"으로 표시됩니다 |
| **Google** | Dooray, Apple | 비공개 | 나만 볼 수 있고, 다른 사람에겐 "바쁨"으로 표시됩니다 |

- Dooray 일정은 업무 일정이므로 다른 캘린더에서도 내용이 공개됩니다.
- Apple/Google 일정은 개인 일정이므로 다른 캘린더에서는 비공개로 처리됩니다.

## 프로젝트 구조

```
├── openclaw.plugin.json        # OpenClaw 플러그인 매니페스트
├── skill.yaml                  # 스킬 정의 (트리거, 명령어)
├── package.json
├── tsconfig.json
├── env.example                 # 환경 변수 템플릿
├── src/
│   ├── index.ts                # 엔트리포인트 (스킬 핸들러)
│   ├── types.ts                # 공통 타입 정의
│   ├── calendars/
│   │   ├── dooray.ts           # Dooray REST API 클라이언트
│   │   ├── google.ts           # Google Calendar API 클라이언트
│   │   └── apple.ts            # Apple iCloud CalDAV 클라이언트
│   └── sync/
│       ├── engine.ts           # 동기화 엔진
│       └── store.ts            # 동기화 매핑 저장소
└── APIPages.txt                # Dooray API 문서 링크
```

## 설치

```bash
git clone https://github.com/geonhuiiii/DoorayCalendarSkills.git
cd DoorayCalendarSkills
npm install       # 의존성 설치 (반드시 먼저 실행)
npm run build     # TypeScript 빌드
```

## 설정

`env.example` 파일을 `.env`로 복사한 뒤 실제 값을 입력합니다.

```bash
cp env.example .env
```

### Dooray (필수)

Dooray CalDAV를 통해 캘린더에 접근합니다. 공공기관(`gov-dooray`)과 일반(`dooray`) 모두 자동 감지됩니다.

> **중요**: 비밀번호는 **Dooray 로그인 비밀번호가 아닙니다!**
> Dooray → 캘린더 → CalDAV 설정 페이지에서 발급된 **CalDAV 전용 비밀번호**를 입력하세요.

```
DOORAY_TENANT_ID=your-tenant-id
DOORAY_USERNAME=your-dooray-email@example.com
DOORAY_PASSWORD=your-caldav-password   # Dooray CalDAV 설정에서 발급
DOORAY_CALENDAR_NAME=              # 선택: 특정 캘린더 이름 지정
```

### Google Calendar (선택)

[Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서 OAuth 2.0 클라이언트를 생성합니다.

```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token
GOOGLE_CALENDAR_ID=primary
```

### Apple Calendar (선택)

[Apple ID 관리 페이지](https://appleid.apple.com/account/manage)에서 앱 전용 비밀번호를 생성합니다.

```
APPLE_USERNAME=your-apple-id@icloud.com
APPLE_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_CALENDAR_NAME=캘린더이름
```

## 사용법

### OpenClaw 스킬로 사용

15분마다 자동 동기화가 실행됩니다. 수동 명령도 지원합니다.

| 명령어 | 설명 |
|--------|------|
| `/calendar-sync` | 수동으로 캘린더 동기화 실행 |
| `/calendar-status` | 동기화 상태 확인 |

### CLI로 직접 실행

```bash
npm run build
node dist/index.js
```

## 빌드

```bash
npm run build     # TypeScript 컴파일
```

## 비공개 처리 방식

각 캘린더 서비스별로 비공개 설정이 다르게 적용됩니다.

- **Google Calendar** — `visibility: "private"` + `transparency: "opaque"`
- **Apple Calendar** — iCal `CLASS:PRIVATE` 속성
- **Dooray** — `scope: "private"` 파라미터

## 기술 스택

- **TypeScript** — 타입 안전한 구현
- **googleapis** — Google Calendar API v3
- **tsdav** — Apple iCloud CalDAV 클라이언트
- **dayjs** — 날짜/시간 처리

## 라이선스

[MIT](LICENSE)
