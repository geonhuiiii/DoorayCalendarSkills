import {
  CalendarClient,
  CalendarEvent,
  CalendarSource,
  DoorayCloud,
  DoorayConfig,
  EventVisibility,
} from "../types";
import { v4 as uuidv4 } from "uuid";

/**
 * Dooray CalDAV 서버 도메인 매핑
 *
 * 민간:     caldav.dooray.com
 * 공공:     caldav.gov-dooray.com
 * 공공업무: caldav.gov-dooray.co.kr
 * 금융:     caldav.dooray.co.kr
 */
const CALDAV_DOMAINS: Record<DoorayCloud, string> = {
  public: "caldav.dooray.com",
  gov: "caldav.gov-dooray.com",
  "gov-kr": "caldav.gov-dooray.co.kr",
  finance: "caldav.dooray.co.kr",
};

/**
 * Dooray 캘린더 CalDAV 클라이언트
 *
 * Dooray는 CalDAV를 공식 지원합니다.
 * 4가지 클라우드 환경(민간/공공/공공업무/금융)을 모두 지원합니다.
 */
export class DoorayCalendarClient implements CalendarClient {
  readonly name: CalendarSource = "dooray";

  private davClient: any; // tsdav.DAVClient
  private allCalendars: any[] = []; // 모든 캘린더 객체
  private primaryCalendarName: string | null = null; // 내 캘린더 이름
  private calendarObj: any = null; // 쓰기용 기본 캘린더
  private calendarUrl: string | null = null;

  constructor(private config: DoorayConfig) {
    const cloud = config.cloud ?? "gov";
    const domain = CALDAV_DOMAINS[cloud];
    console.log(`[dooray] 환경: ${cloud} (${domain})`);
    console.log(`[dooray] tenant: ${config.tenantId}`);
    console.log(`[dooray] user: ${config.username}`);
  }

  /** tsdav CalDAV 클라이언트 초기화 */
  private async ensureInitialized(): Promise<void> {
    if (this.davClient) return;

    const { DAVClient } = await import("tsdav");

    const cloud = this.config.cloud ?? "gov";
    const domain = CALDAV_DOMAINS[cloud];
    const serverUrl = `https://${domain}`;

    console.log(`[dooray] CalDAV 서버: ${serverUrl}`);

    // CalDAV 전용 비밀번호로 연결
    const client = new DAVClient({
      serverUrl,
      credentials: {
        username: this.config.username,
        password: this.config.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });

    await client.login();
    console.log(`[dooray] CalDAV 로그인 성공!`);

    // 캘린더 목록 조회
    const calendars = await client.fetchCalendars();
    console.log(
      `[dooray] 캘린더 ${calendars.length}개 발견:`,
      calendars.map((c: any) => c.displayName ?? c.url).join(", ")
    );

    if (calendars.length === 0) {
      throw new Error("Dooray 캘린더를 찾을 수 없습니다.");
    }

    this.davClient = client;
    this.allCalendars = calendars;

    // 내 캘린더 (쓰기용) 결정 — 첫 번째 캘린더가 기본적으로 내 캘린더
    if (this.config.calendarName) {
      const target = calendars.find(
        (cal: any) =>
          cal.displayName?.toLowerCase() ===
          this.config.calendarName!.toLowerCase()
      );
      if (target) {
        this.calendarObj = target;
        this.calendarUrl = target.url;
        this.primaryCalendarName = String(target.displayName ?? "");
        console.log(
          `[dooray] 내 캘린더: "${target.displayName}" → ${target.url}`
        );
      }
    }

    if (!this.calendarObj) {
      this.calendarObj = calendars[0];
      this.calendarUrl = calendars[0].url;
      this.primaryCalendarName = String(calendars[0].displayName ?? "");
      console.log(
        `[dooray] 내 캘린더: "${calendars[0].displayName}" → ${calendars[0].url}`
      );
    }

    console.log(
      `[dooray] 전체 ${calendars.length}개 캘린더에서 일정을 가져옵니다`
    );
  }

  /**
   * Dooray의 **모든** 캘린더(내 캘린더 + 공유 캘린더)에서
   * 지정 기간의 이벤트를 조회합니다.
   *
   * 다른 사람/공유 캘린더 이벤트에는 isOwnCalendar=false가 설정됩니다.
   */
  async getEvents(from: string, to: string): Promise<CalendarEvent[]> {
    await this.ensureInitialized();

    const fromTime = new Date(from).getTime();
    const toTime = new Date(to).getTime();
    const allEvents: CalendarEvent[] = [];

    for (const cal of this.allCalendars) {
      const calName = cal.displayName ?? cal.url;
      const isOwn =
        this.primaryCalendarName != null &&
        calName === this.primaryCalendarName;

      try {
        const calendarObjects = await this.davClient.fetchCalendarObjects({
          calendar: cal,
        });

        console.log(
          `[dooray] 캘린더 "${calName}": ${calendarObjects.length}개 객체 ${isOwn ? "(내 캘린더)" : "(공유)"}`
        );

        const events = calendarObjects
          .map((obj: any) => this.parseICalToEvent(obj, calName, isOwn))
          .filter((evt: CalendarEvent | null): evt is CalendarEvent => {
            if (!evt) return false;
            const eventStart = new Date(evt.startTime).getTime();
            const eventEnd = new Date(evt.endTime).getTime();
            return eventEnd >= fromTime && eventStart <= toTime;
          });

        allEvents.push(...events);
      } catch (err) {
        console.error(`[dooray] 캘린더 "${calName}" 조회 실패:`, err);
      }
    }

    console.log(`[dooray] 총 ${allEvents.length}개 이벤트 (전체 캘린더)`);
    return allEvents;
  }

  /**
   * Dooray 캘린더에 이벤트를 생성합니다.
   */
  async createEvent(
    event: CalendarEvent,
    visibility: EventVisibility
  ): Promise<string> {
    await this.ensureInitialized();

    const uid = uuidv4();
    const icalData = this.toICal(uid, event, visibility);

    await this.davClient.createCalendarObject({
      calendar: this.calendarObj,
      filename: `${uid}.ics`,
      iCalString: icalData,
    });

    return uid;
  }

  /**
   * Dooray 캘린더 이벤트를 업데이트합니다.
   */
  async updateEvent(
    targetId: string,
    event: CalendarEvent,
    visibility: EventVisibility
  ): Promise<void> {
    await this.ensureInitialized();

    const icalData = this.toICal(targetId, event, visibility);
    const objectUrl = `${this.calendarUrl}${targetId}.ics`;

    await this.davClient.updateCalendarObject({
      calendarObject: {
        url: objectUrl,
        data: icalData,
      },
    });
  }

  /**
   * Dooray 캘린더 이벤트를 삭제합니다.
   */
  async deleteEvent(targetId: string): Promise<void> {
    await this.ensureInitialized();

    const objectUrl = `${this.calendarUrl}${targetId}.ics`;

    await this.davClient.deleteCalendarObject({
      calendarObject: { url: objectUrl },
    });
  }

  // ────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────

  /** iCal 객체를 CalendarEvent로 파싱 */
  private parseICalToEvent(
    obj: any,
    calendarName: string,
    isOwnCalendar: boolean
  ): CalendarEvent | null {
    try {
      const data = obj.data;
      if (!data) return null;

      const uidMatch = data.match(/UID:(.+)/);
      const summaryMatch = data.match(/SUMMARY:(.+)/);
      const descMatch = data.match(/DESCRIPTION:(.+)/);
      const locationMatch = data.match(/LOCATION:(.+)/);
      const dtStartMatch =
        data.match(/DTSTART(?:;[^:]*)?:(\d{8}T\d{6}Z?)/) ??
        data.match(/DTSTART(?:;[^:]*)?:(\d{8})/);
      const dtEndMatch =
        data.match(/DTEND(?:;[^:]*)?:(\d{8}T\d{6}Z?)/) ??
        data.match(/DTEND(?:;[^:]*)?:(\d{8})/);
      const lastModMatch = data.match(/LAST-MODIFIED:(.+)/);
      const rruleMatch = data.match(/RRULE:(.+)/);

      if (!dtStartMatch) return null;

      const isAllDay = !dtStartMatch[1].includes("T");
      const rawTitle = summaryMatch?.[1]?.trim() ?? "";

      // 공유 캘린더인 경우 제목 앞에 캘린더 이름 표시
      const title = isOwnCalendar
        ? rawTitle
        : `[${calendarName}] ${rawTitle}`;

      const startTime = this.parseICalDate(dtStartMatch[1]);
      let endTime = dtEndMatch
        ? this.parseICalDate(dtEndMatch[1])
        : null;

      // endTime이 없거나 startTime과 같으면 기본값 설정
      if (!endTime || endTime === startTime) {
        if (isAllDay) {
          // 종일 이벤트: 다음 날로 설정
          const d = new Date(startTime);
          d.setDate(d.getDate() + 1);
          endTime = d.toISOString().split("T")[0];
        } else {
          // 시간 이벤트: 1시간 후로 설정
          const d = new Date(startTime);
          d.setTime(d.getTime() + 60 * 60 * 1000);
          endTime = d.toISOString();
        }
      }

      return {
        sourceId: uidMatch?.[1]?.trim() ?? obj.url ?? "",
        source: "dooray",
        sourceCalendarName: calendarName,
        isOwnCalendar,
        title,
        description: descMatch?.[1]?.trim() ?? "",
        location: locationMatch?.[1]?.trim() ?? "",
        startTime,
        endTime,
        isAllDay,
        // Dooray 일정은 다른 캘린더에 공개로 동기화
        visibility: "public",
        updatedAt: lastModMatch?.[1]?.trim() ?? "",
        recurrence: rruleMatch?.[1]?.trim() ?? undefined,
      };
    } catch (err) {
      console.error("[dooray] 이벤트 파싱 실패:", err);
      return null;
    }
  }

  /** iCal 날짜 → ISO 8601 */
  private parseICalDate(icalDate: string): string {
    const cleaned = icalDate.trim();
    if (cleaned.length === 8) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    }
    if (cleaned.length >= 15) {
      const date = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
      const time = `${cleaned.slice(9, 11)}:${cleaned.slice(11, 13)}:${cleaned.slice(13, 15)}`;
      const tz = cleaned.endsWith("Z") ? "Z" : "";
      return `${date}T${time}${tz}`;
    }
    return cleaned;
  }

  /** ISO 8601 → iCal 포맷 */
  private toICalDate(isoDate: string): string {
    if (!isoDate.includes("T")) {
      return isoDate.replace(/-/g, "");
    }
    return isoDate.replace(/-/g, "").replace(/:/g, "");
  }

  /** CalendarEvent → iCal 문자열 */
  private toICal(
    uid: string,
    event: CalendarEvent,
    visibility: EventVisibility
  ): string {
    const now = new Date()
      .toISOString()
      .replace(/-/g, "")
      .replace(/:/g, "")
      .replace(/\.\d{3}/, "");

    const title =
      visibility === "private" ? `🔒 ${event.title}` : event.title;

    const description =
      visibility === "private"
        ? "(비공개 일정) 다른 캘린더에서 동기화된 일정입니다."
        : event.description ?? "";

    const dtStartParam = event.isAllDay ? ";VALUE=DATE" : "";
    const dtEndParam = event.isAllDay ? ";VALUE=DATE" : "";

    const ical = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OpenClaw Dooray Sync//EN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART${dtStartParam}:${this.toICalDate(event.startTime)}`,
      `DTEND${dtEndParam}:${this.toICalDate(event.endTime)}`,
      `SUMMARY:${this.escapeICal(title)}`,
    ];

    if (description) {
      ical.push(`DESCRIPTION:${this.escapeICal(description)}`);
    }

    if (event.location && visibility !== "private") {
      ical.push(`LOCATION:${this.escapeICal(event.location)}`);
    }

    if (visibility === "private") {
      ical.push("CLASS:PRIVATE");
    } else {
      ical.push("CLASS:PUBLIC");
    }

    if (event.recurrence) {
      ical.push(`RRULE:${event.recurrence}`);
    }

    ical.push("END:VEVENT", "END:VCALENDAR");

    return ical.join("\r\n");
  }

  /** iCal 특수 문자 이스케이프 */
  private escapeICal(text: string): string {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }
}
