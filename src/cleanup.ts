import "dotenv/config";
import { DoorayCloud } from "./types";

/**
 * 두레이 캘린더 일괄 정리 스크립트
 *
 * 사용법:
 *   node dist/cleanup.js                  # 미리보기 (삭제 안 함)
 *   node dist/cleanup.js --delete         # 실제 삭제 실행
 *   node dist/cleanup.js --delete --all   # 내 캘린더의 모든 일정 삭제
 *
 * 기본 동작: 이상한 일정만 삭제 (1970년, 동기화로 생긴 일정 등)
 * --all: 내 캘린더의 모든 일정을 삭제 (완전 초기화)
 */

const CALDAV_DOMAINS: Record<DoorayCloud, string> = {
  public: "caldav.dooray.com",
  gov: "caldav.gov-dooray.com",
  "gov-kr": "caldav.gov-dooray.co.kr",
  finance: "caldav.dooray.co.kr",
};

interface EventInfo {
  url: string;
  uid: string;
  title: string;
  startDate: string;
  endDate: string;
  reason: string; // 삭제 사유
}

async function main() {
  const args = process.argv.slice(2);
  const doDelete = args.includes("--delete");
  const deleteAll = args.includes("--all");

  console.log("========================================");
  console.log("  두레이 캘린더 정리 스크립트");
  console.log("========================================");
  console.log(`모드: ${doDelete ? "🗑️  실제 삭제" : "👀 미리보기 (삭제 안 함)"}`);
  if (deleteAll) {
    console.log("범위: ⚠️  모든 일정 삭제");
  } else {
    console.log("범위: 이상한 일정만 삭제");
  }
  console.log("");

  // 환경변수에서 설정 읽기
  const cloud = (process.env.DOORAY_CLOUD as DoorayCloud) ?? "gov";
  const domain = CALDAV_DOMAINS[cloud];
  const username = process.env.DOORAY_USERNAME ?? "";
  const password = process.env.DOORAY_PASSWORD ?? "";
  const calendarName = process.env.DOORAY_CALENDAR_NAME;

  if (!username || !password) {
    console.error("오류: .env 파일에 DOORAY_USERNAME, DOORAY_PASSWORD를 설정하세요.");
    process.exit(1);
  }

  console.log(`CalDAV 서버: ${domain}`);
  console.log(`사용자: ${username}`);
  console.log("");

  // CalDAV 연결
  const { DAVClient } = await import("tsdav");
  const client = new DAVClient({
    serverUrl: `https://${domain}`,
    credentials: { username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  await client.login();
  console.log("CalDAV 로그인 성공!");

  // 캘린더 찾기
  const calendars = await client.fetchCalendars();
  console.log(`캘린더 ${calendars.length}개 발견:`,
    calendars.map((c: any) => c.displayName ?? c.url).join(", ")
  );

  let targetCal: any = null;
  if (calendarName) {
    targetCal = calendars.find(
      (c: any) => c.displayName?.toLowerCase() === calendarName.toLowerCase()
    );
  }
  if (!targetCal) {
    targetCal = calendars[0];
  }

  const targetName = targetCal.displayName ?? targetCal.url;
  console.log(`\n정리 대상 캘린더: "${targetName}"`);
  console.log("");

  // 모든 이벤트 가져오기
  const objects = await client.fetchCalendarObjects({ calendar: targetCal });
  console.log(`총 ${objects.length}개 이벤트 발견\n`);

  // 삭제 대상 분류
  const toDelete: EventInfo[] = [];

  for (const obj of objects) {
    const data = obj.data;
    if (!data) continue;

    const uidMatch = data.match(/UID:(.+)/);
    const summaryMatch = data.match(/SUMMARY:(.+)/);
    const dtStartMatch =
      data.match(/DTSTART(?:;[^:]*)?:(\S+)/) ;
    const dtEndMatch =
      data.match(/DTEND(?:;[^:]*)?:(\S+)/);

    const uid = uidMatch?.[1]?.trim() ?? "";
    const title = summaryMatch?.[1]?.trim() ?? "(제목 없음)";
    const startRaw = dtStartMatch?.[1]?.trim() ?? "";
    const endRaw = dtEndMatch?.[1]?.trim() ?? "";

    const info: EventInfo = {
      url: obj.url,
      uid,
      title,
      startDate: startRaw,
      endDate: endRaw,
      reason: "",
    };

    if (deleteAll) {
      // --all: 모든 일정 삭제
      info.reason = "전체 삭제";
      toDelete.push(info);
      continue;
    }

    // 이상한 일정 판별
    const digits = startRaw.replace(/[^0-9]/g, "");
    const year = digits.length >= 4 ? parseInt(digits.slice(0, 4)) : 0;

    // 1) 1970년 또는 2000년 이전 일정
    if (year > 0 && year < 2000) {
      info.reason = `비정상 연도 (${year}년)`;
      toDelete.push(info);
      continue;
    }

    // 2) 동기화로 생긴 일정 (제목에 🔒 가 있으면 다른 캘린더에서 넘어온 것)
    if (title.startsWith("🔒")) {
      info.reason = "동기화 일정 (🔒 비공개)";
      toDelete.push(info);
      continue;
    }

    // 3) 동기화 접두사 [캘린더이름] 가 있는 일정
    if (title.match(/^\[.+\]\s/)) {
      info.reason = "동기화 일정 ([캘린더] 접두사)";
      toDelete.push(info);
      continue;
    }

    // 4) 설명에 "동기화된 일정" 문구가 있는 것
    if (data.includes("다른 캘린더에서 동기화된 일정")) {
      info.reason = "동기화 일정 (설명 문구)";
      toDelete.push(info);
      continue;
    }

    // 5) PRODID가 OpenClaw인 것 (우리 도구가 만든 것)
    if (data.includes("PRODID:-//OpenClaw")) {
      info.reason = "OpenClaw이 생성한 일정";
      toDelete.push(info);
      continue;
    }
  }

  // 결과 출력
  const keep = objects.length - toDelete.length;
  console.log("========================================");
  console.log(`  삭제 대상: ${toDelete.length}개`);
  console.log(`  유지:      ${keep}개`);
  console.log("========================================\n");

  if (toDelete.length === 0) {
    console.log("삭제할 일정이 없습니다. 깨끗합니다!");
    return;
  }

  // 삭제 대상 목록 출력
  for (let i = 0; i < toDelete.length; i++) {
    const e = toDelete[i];
    console.log(
      `  ${i + 1}. "${e.title}" | ${e.startDate} ~ ${e.endDate} | 사유: ${e.reason}`
    );
  }
  console.log("");

  if (!doDelete) {
    console.log("─────────────────────────────────────");
    console.log("미리보기 모드입니다. 실제로 삭제하려면:");
    console.log("");
    console.log("  node dist/cleanup.js --delete");
    console.log("");
    console.log("모든 일정을 삭제하려면:");
    console.log("  node dist/cleanup.js --delete --all");
    console.log("─────────────────────────────────────");
    return;
  }

  // 실제 삭제
  console.log("삭제 시작...\n");
  let success = 0;
  let fail = 0;

  for (let i = 0; i < toDelete.length; i++) {
    const e = toDelete[i];
    try {
      await client.deleteCalendarObject({
        calendarObject: { url: e.url },
      });
      success++;
      console.log(`  ✅ ${i + 1}/${toDelete.length} 삭제: "${e.title}"`);
    } catch (err) {
      fail++;
      console.error(`  ❌ ${i + 1}/${toDelete.length} 실패: "${e.title}" — ${err}`);
    }
  }

  console.log("\n========================================");
  console.log(`  완료: 삭제 ${success}건, 실패 ${fail}건`);
  console.log("========================================");

  // sync store도 초기화
  const fs = await import("fs");
  const path = await import("path");
  const storePath = path.join(process.cwd(), ".sync-store.json");
  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
    console.log("\n.sync-store.json 초기화 완료");
  }
}

main().catch((err) => {
  console.error("오류 발생:", err);
  process.exit(1);
});
