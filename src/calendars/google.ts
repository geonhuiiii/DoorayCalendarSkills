import {
  CalendarClient,
  CalendarEvent,
  CalendarSource,
  EventVisibility,
  GoogleConfig,
} from "../types";

/**
 * Google Calendar API 클라이언트
 *
 * googleapis 라이브러리를 사용하여 Google Calendar v3 API와 통신합니다.
 * OAuth2 인증을 사용하며, refresh token으로 자동 갱신합니다.
 */
export class GoogleCalendarClient implements CalendarClient {
  readonly name: CalendarSource = "google";

  private readonly calendarId: string;
  private auth: any; // google.auth.OAuth2
  private calendar: any; // google.calendar_v3.Calendar

  constructor(private config: GoogleConfig) {
    this.calendarId = config.calendarId ?? "primary";
  }

  /** googleapis 초기화 (지연 로드) */
  private async ensureInitialized(): Promise<void> {
    if (this.calendar) return;

    const { google } = await import("googleapis");
    this.auth = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret
    );
    this.auth.setCredentials({ refresh_token: this.config.refreshToken });
    this.calendar = google.calendar({ version: "v3", auth: this.auth });
  }

  /**
   * Google Calendar에서 지정 기간의 이벤트를 조회합니다.
   */
  async getEvents(from: string, to: string): Promise<CalendarEvent[]> {
    await this.ensureInitialized();

    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: from,
        timeMax: to,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });

      const items = response.data.items ?? [];
      for (const item of items) {
        events.push(this.toCalendarEvent(item));
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return events;
  }

  /**
   * Google Calendar에 이벤트를 생성합니다.
   * visibility에 따라 공개/비공개를 설정합니다.
   */
  async createEvent(
    event: CalendarEvent,
    visibility: EventVisibility
  ): Promise<string> {
    await this.ensureInitialized();

    const body = this.toGoogleEvent(event, visibility);

    const response = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: body,
    });

    return response.data.id!;
  }

  /**
   * Google Calendar 이벤트를 업데이트합니다.
   */
  async updateEvent(
    targetId: string,
    event: CalendarEvent,
    visibility: EventVisibility
  ): Promise<void> {
    await this.ensureInitialized();

    const body = this.toGoogleEvent(event, visibility);

    await this.calendar.events.update({
      calendarId: this.calendarId,
      eventId: targetId,
      requestBody: body,
    });
  }

  /**
   * Google Calendar 이벤트를 삭제합니다.
   */
  async deleteEvent(targetId: string): Promise<void> {
    await this.ensureInitialized();

    await this.calendar.events.delete({
      calendarId: this.calendarId,
      eventId: targetId,
    });
  }

  // ────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────

  /** Google Calendar 이벤트를 공통 CalendarEvent로 변환 */
  private toCalendarEvent(item: any): CalendarEvent {
    const isAllDay = !!item.start?.date;

    return {
      sourceId: item.id,
      source: "google",
      isOwnCalendar: true, // Google 캘린더는 항상 내 캘린더
      title: item.summary ?? "",
      description: item.description ?? "",
      location: item.location ?? "",
      startTime: isAllDay ? item.start.date : item.start.dateTime,
      endTime: isAllDay ? item.end.date : item.end.dateTime,
      isAllDay,
      // Google 캘린더 일정은 다른 캘린더로 동기화 시 비공개
      visibility: "private",
      updatedAt: item.updated ?? "",
      recurrence: item.recurrence?.[0] ?? undefined,
    };
  }

  /** CalendarEvent를 Google Calendar API 포맷으로 변환 */
  private toGoogleEvent(
    event: CalendarEvent,
    visibility: EventVisibility
  ): Record<string, any> {
    const body: Record<string, any> = {
      summary: visibility === "private"
        ? `🔒 ${event.title}`
        : event.title,
      description: visibility === "private"
        ? "(비공개 일정) 다른 캘린더에서 동기화된 일정입니다."
        : event.description ?? "",
      // 비공개 설정: Google Calendar visibility 속성
      visibility: visibility === "private" ? "private" : "default",
    };

    if (event.location && visibility !== "private") {
      body.location = event.location;
    }

    // 종일 이벤트 vs 시간 지정 이벤트
    if (event.isAllDay) {
      body.start = { date: event.startTime.split("T")[0] };
      body.end = { date: event.endTime.split("T")[0] };
    } else {
      body.start = { dateTime: event.startTime };
      body.end = { dateTime: event.endTime };
    }

    if (event.recurrence) {
      body.recurrence = [event.recurrence];
    }

    // 비공개일 때 다른 사람에게 "바쁨"으로만 표시
    if (visibility === "private") {
      body.transparency = "opaque"; // "바쁨" 표시
    }

    // 다른 사람/공유 캘린더의 일정은 알람(리마인더) 제거
    if (event.isOwnCalendar === false) {
      body.reminders = {
        useDefault: false,
        overrides: [], // 알람 없음
      };
    }

    return body;
  }
}
