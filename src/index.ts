import "dotenv/config";
import { SyncEngine } from "./sync/engine";
import { DoorayCalendarClient } from "./calendars/dooray";
import { GoogleCalendarClient } from "./calendars/google";
import { AppleCalendarClient } from "./calendars/apple";
import { PluginConfig, SyncResult } from "./types";

/**
 * OpenClaw Dooray Calendar Sync Skill
 *
 * Dooray·Apple·Google 캘린더를 통합 동기화합니다.
 *
 * 동기화 규칙:
 *   - Dooray 캘린더 일정 → 다른 캘린더에 "공개"로 추가 (모두가 내용을 볼 수 있음)
 *   - Apple/Google 캘린더 일정 → 다른 캘린더에 "비공개"로 추가 (나만 볼 수 있음)
 */

// ────────────────────────────────────────────
// OpenClaw 스킬 핸들러
// ────────────────────────────────────────────

/** 스킬 초기화 — OpenClaw에서 플러그인 로드 시 호출 */
export async function initialize(config: PluginConfig): Promise<SyncEngine> {
  const engine = new SyncEngine();

  // 1) Dooray 캘린더는 필수
  engine.registerClient(new DoorayCalendarClient(config.dooray));
  console.log("[init] Dooray 캘린더 클라이언트 등록 완료");

  // 2) Google Calendar (선택)
  if (config.google) {
    engine.registerClient(new GoogleCalendarClient(config.google));
    console.log("[init] Google 캘린더 클라이언트 등록 완료");
  }

  // 3) Apple Calendar (선택)
  if (config.apple) {
    engine.registerClient(new AppleCalendarClient(config.apple));
    console.log("[init] Apple 캘린더 클라이언트 등록 완료");
  }

  return engine;
}

/**
 * /calendar-sync 명령 핸들러
 * 수동으로 캘린더 동기화를 실행합니다.
 */
export async function handleCalendarSync(config: PluginConfig): Promise<string> {
  try {
    const engine = await initialize(config);
    const result: SyncResult = await engine.sync();

    return formatSyncResult(result);
  } catch (err) {
    return `캘린더 동기화 실패: ${err}`;
  }
}

/**
 * /calendar-status 명령 핸들러
 * 현재 동기화 상태를 확인합니다.
 */
export async function handleCalendarStatus(config: PluginConfig): Promise<string> {
  try {
    const engine = await initialize(config);
    return engine.getStatus();
  } catch (err) {
    return `상태 확인 실패: ${err}`;
  }
}

/**
 * 스케줄 트리거 핸들러
 * 15분마다 자동으로 호출됩니다.
 */
export async function handleScheduledSync(config: PluginConfig): Promise<void> {
  console.log(`[${new Date().toISOString()}] 스케줄 동기화 시작...`);

  try {
    const engine = await initialize(config);
    const result = await engine.sync();
    console.log(formatSyncResult(result));
  } catch (err) {
    console.error("스케줄 동기화 실패:", err);
  }
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function formatSyncResult(result: SyncResult): string {
  const lines = [
    "📅 캘린더 동기화 완료",
    "",
    `  ✅ 생성: ${result.created}건`,
    `  🔄 업데이트: ${result.updated}건`,
    `  🗑️ 삭제: ${result.deleted}건`,
  ];

  if (result.errors.length > 0) {
    lines.push(`  ⚠️ 오류: ${result.errors.length}건`);
    for (const err of result.errors.slice(0, 5)) {
      lines.push(`    - [${err.source}→${err.target}] ${err.message}`);
    }
    if (result.errors.length > 5) {
      lines.push(`    ... 외 ${result.errors.length - 5}건`);
    }
  }

  lines.push("", "동기화 규칙:");
  lines.push("  • Dooray 일정 → 다른 캘린더에 공개로 표시");
  lines.push("  • Apple/Google 일정 → 다른 캘린더에 비공개로 표시 (나만 보기)");

  return lines.join("\n");
}

// ────────────────────────────────────────────
// CLI 직접 실행 지원
// ────────────────────────────────────────────

if (require.main === module) {
  // 환경 변수에서 설정 읽기
  const config: PluginConfig = {
    dooray: {
      apiToken: process.env.DOORAY_API_TOKEN ?? "",
      tenantId: process.env.DOORAY_TENANT_ID ?? "",
    },
    google: process.env.GOOGLE_CLIENT_ID
      ? {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          refreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? "",
          calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
        }
      : undefined,
    apple: process.env.APPLE_USERNAME
      ? {
          username: process.env.APPLE_USERNAME,
          appSpecificPassword: process.env.APPLE_APP_PASSWORD ?? "",
          calendarName: process.env.APPLE_CALENDAR_NAME,
        }
      : undefined,
  };

  handleCalendarSync(config).then(console.log).catch(console.error);
}
