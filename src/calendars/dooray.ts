import {
  CalendarClient,
  CalendarEvent,
  CalendarSource,
  DoorayConfig,
  EventVisibility,
} from "../types";

/**
 * Dooray 캘린더 API 클라이언트
 *
 * Dooray REST API를 사용하여 캘린더 일정을 조회/생성/수정/삭제합니다.
 * API 문서: https://helpdesk.dooray.com/share/pages/9wWo-xwiR66BO5LGshgVTg/2939987647631384419
 */
export class DoorayCalendarClient implements CalendarClient {
  readonly name: CalendarSource = "dooray";

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private config: DoorayConfig) {
    this.baseUrl = "https://api.dooray.com";
    this.headers = {
      Authorization: `dooray-api ${config.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Dooray 캘린더에서 지정 기간의 이벤트를 조회합니다.
   */
  async getEvents(from: string, to: string): Promise<CalendarEvent[]> {
    // 캘린더 목록 먼저 조회
    const calendars = await this.getCalendars();
    const allEvents: CalendarEvent[] = [];

    for (const calendar of calendars) {
      const events = await this.getCalendarEvents(calendar.id, from, to);
      allEvents.push(...events);
    }

    return allEvents;
  }

  /**
   * Dooray 캘린더에 이벤트를 생성합니다.
   */
  async createEvent(event: CalendarEvent, visibility: EventVisibility): Promise<string> {
    const calendars = await this.getCalendars();
    if (calendars.length === 0) {
      throw new Error("Dooray 캘린더를 찾을 수 없습니다.");
    }

    const calendarId = calendars[0].id; // 기본 캘린더 사용
    const body = this.toRequestBody(event, visibility);

    const response = await fetch(
      `${this.baseUrl}/calendar/v1/calendars/${calendarId}/events`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dooray 이벤트 생성 실패: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as any;
    return data.result?.id ?? data.id;
  }

  /**
   * Dooray 캘린더 이벤트를 업데이트합니다.
   */
  async updateEvent(
    targetId: string,
    event: CalendarEvent,
    visibility: EventVisibility
  ): Promise<void> {
    const calendars = await this.getCalendars();
    if (calendars.length === 0) {
      throw new Error("Dooray 캘린더를 찾을 수 없습니다.");
    }

    const calendarId = calendars[0].id;
    const body = this.toRequestBody(event, visibility);

    const response = await fetch(
      `${this.baseUrl}/calendar/v1/calendars/${calendarId}/events/${targetId}`,
      {
        method: "PUT",
        headers: this.headers,
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dooray 이벤트 업데이트 실패: ${response.status} - ${errorText}`);
    }
  }

  /**
   * Dooray 캘린더 이벤트를 삭제합니다.
   */
  async deleteEvent(targetId: string): Promise<void> {
    const calendars = await this.getCalendars();
    if (calendars.length === 0) return;

    const calendarId = calendars[0].id;

    const response = await fetch(
      `${this.baseUrl}/calendar/v1/calendars/${calendarId}/events/${targetId}`,
      {
        method: "DELETE",
        headers: this.headers,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dooray 이벤트 삭제 실패: ${response.status} - ${errorText}`);
    }
  }

  // ────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────

  /** Dooray 캘린더 목록 조회 */
  private async getCalendars(): Promise<{ id: string; name: string }[]> {
    const response = await fetch(`${this.baseUrl}/calendar/v1/calendars`, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Dooray 캘린더 목록 조회 실패: ${response.status}`);
    }

    const data = (await response.json()) as any;
    const calendars = data.result ?? [];

    return calendars.map((cal: any) => ({
      id: cal.id,
      name: cal.name ?? cal.summary ?? "Untitled",
    }));
  }

  /** 특정 캘린더의 이벤트 조회 */
  private async getCalendarEvents(
    calendarId: string,
    from: string,
    to: string
  ): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      fromDateTime: from,
      toDateTime: to,
    });

    const response = await fetch(
      `${this.baseUrl}/calendar/v1/calendars/${calendarId}/events?${params}`,
      {
        method: "GET",
        headers: this.headers,
      }
    );

    if (!response.ok) {
      console.error(`Dooray 이벤트 조회 실패 (calendar: ${calendarId}): ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const events = data.result ?? [];

    return events.map((evt: any) => this.toCalendarEvent(evt));
  }

  /** Dooray API 응답을 CalendarEvent로 변환 */
  private toCalendarEvent(raw: any): CalendarEvent {
    return {
      sourceId: raw.id,
      source: "dooray",
      title: raw.subject ?? raw.summary ?? "",
      description: raw.body?.content ?? raw.description ?? "",
      location: raw.location ?? "",
      startTime: raw.startedAt ?? raw.start?.dateTime ?? "",
      endTime: raw.endedAt ?? raw.end?.dateTime ?? "",
      isAllDay: raw.allDay ?? false,
      visibility: "public", // Dooray 일정은 공개로 동기화
      updatedAt: raw.updatedAt ?? raw.modified ?? "",
      recurrence: raw.recurrence ?? undefined,
    };
  }

  /** CalendarEvent를 Dooray API 요청 본문으로 변환 */
  private toRequestBody(
    event: CalendarEvent,
    visibility: EventVisibility
  ): Record<string, any> {
    const body: Record<string, any> = {
      subject: event.title,
      body: {
        content: event.description ?? "",
        mimeType: "text/plain",
      },
      startedAt: event.startTime,
      endedAt: event.endTime,
      allDay: event.isAllDay,
    };

    if (event.location) {
      body.location = event.location;
    }

    // 비공개 설정: Dooray API의 가시성 옵션
    if (visibility === "private") {
      body.scope = "private";
    }

    if (event.recurrence) {
      body.recurrence = event.recurrence;
    }

    return body;
  }
}
