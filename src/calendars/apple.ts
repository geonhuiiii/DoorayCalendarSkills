import {
  CalendarClient,
  CalendarEvent,
  CalendarSource,
  AppleConfig,
  EventVisibility,
} from "../types";
import { v4 as uuidv4 } from "uuid";

/**
 * Apple Calendar (iCloud CalDAV) 클라이언트
 *
 * tsdav 라이브러리를 사용하여 iCloud CalDAV 서버와 통신합니다.
 * Apple ID + 앱 전용 비밀번호로 인증합니다.
 */
export class AppleCalendarClient implements CalendarClient {
  readonly name: CalendarSource = "apple";

  private davClient: any; // tsdav.DAVClient
  private calendarObj: any = null;
  private calendarUrl: string | null = null;

  constructor(private config: AppleConfig) {}

  /** tsdav 클라이언트 초기화 (지연 로드) */
  private async ensureInitialized(): Promise<void> {
    if (this.davClient) return;

    const { DAVClient } = await import("tsdav");

    this.davClient = new DAVClient({
      serverUrl: "https://caldav.icloud.com",
      credentials: {
        username: this.config.username,
        password: this.config.appSpecificPassword,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });

    await this.davClient.login();

    // 캘린더 목록에서 대상 캘린더 URL 찾기
    const calendars = await this.davClient.fetchCalendars();
    if (this.config.calendarName) {
      const target = calendars.find(
        (cal: any) =>
          cal.displayName?.toLowerCase() === this.config.calendarName!.toLowerCase()
      );
      if (target) {
        this.calendarObj = target;
        this.calendarUrl = target.url;
      }
    }

    // 이름으로 못 찾으면 첫 번째 캘린더 사용
    if (!this.calendarObj && calendars.length > 0) {
      this.calendarObj = calendars[0];
      this.calendarUrl = calendars[0].url;
    }

    if (!this.calendarObj) {
      throw new Error("Apple 캘린더를 찾을 수 없습니다.");
    }
  }

  /**
   * Apple Calendar에서 지정 기간의 이벤트를 조회합니다.
   */
  async getEvents(from: string, to: string): Promise<CalendarEvent[]> {
    await this.ensureInitialized();

    const calendarObjects = await this.davClient.fetchCalendarObjects({
      calendar: this.calendarObj,
      timeRange: {
        start: from,
        end: to,
      },
    });

    return calendarObjects
      .map((obj: any) => this.parseICalToEvent(obj))
      .filter((evt: CalendarEvent | null): evt is CalendarEvent => evt !== null);
  }

  /**
   * Apple Calendar에 이벤트를 생성합니다.
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
   * Apple Calendar 이벤트를 업데이트합니다.
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
   * Apple Calendar 이벤트를 삭제합니다.
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
  private parseICalToEvent(obj: any): CalendarEvent | null {
    try {
      const data = obj.data;
      if (!data) return null;

      // 간단한 iCal 파싱 (VEVENT 추출)
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
      const classMatch = data.match(/CLASS:(.+)/);

      if (!dtStartMatch) return null;

      const isAllDay = !dtStartMatch[1].includes("T");

      return {
        sourceId: uidMatch?.[1]?.trim() ?? obj.url ?? "",
        source: "apple",
        title: summaryMatch?.[1]?.trim() ?? "",
        description: descMatch?.[1]?.trim() ?? "",
        location: locationMatch?.[1]?.trim() ?? "",
        startTime: this.parseICalDate(dtStartMatch[1]),
        endTime: dtEndMatch
          ? this.parseICalDate(dtEndMatch[1])
          : this.parseICalDate(dtStartMatch[1]),
        isAllDay,
        // Apple 캘린더 일정은 다른 캘린더로 동기화 시 비공개
        visibility: "private",
        updatedAt: lastModMatch?.[1]?.trim() ?? "",
        recurrence: rruleMatch?.[1]?.trim() ?? undefined,
      };
    } catch (err) {
      console.error("Apple 이벤트 파싱 실패:", err);
      return null;
    }
  }

  /** iCal 날짜 문자열을 ISO 8601로 변환 */
  private parseICalDate(icalDate: string): string {
    // 20260215T100000Z → 2026-02-15T10:00:00Z
    // 20260215 → 2026-02-15
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

  /** ISO 8601 날짜를 iCal 포맷으로 변환 */
  private toICalDate(isoDate: string): string {
    // 종일 이벤트: 2026-02-15 → 20260215
    if (!isoDate.includes("T")) {
      return isoDate.replace(/-/g, "");
    }
    // 시간 이벤트: 2026-02-15T10:00:00Z → 20260215T100000Z
    return isoDate.replace(/-/g, "").replace(/:/g, "");
  }

  /** CalendarEvent를 iCal 문자열로 변환 */
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

    let ical = [
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

    // CalDAV CLASS 속성으로 비공개 설정
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
