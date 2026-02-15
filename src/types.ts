/**
 * 캘린더 이벤트의 공통 타입 정의
 */

/** 이벤트 가시성(공개/비공개) */
export type EventVisibility = "public" | "private";

/** 이벤트 출처 캘린더 */
export type CalendarSource = "dooray" | "google" | "apple";

/** 통합 캘린더 이벤트 */
export interface CalendarEvent {
  /** 원본 캘린더에서의 이벤트 ID */
  sourceId: string;
  /** 이벤트가 속한 원본 캘린더 */
  source: CalendarSource;
  /** 이벤트 제목 */
  title: string;
  /** 이벤트 설명 */
  description?: string;
  /** 이벤트 장소 */
  location?: string;
  /** 시작 시간 (ISO 8601) */
  startTime: string;
  /** 종료 시간 (ISO 8601) */
  endTime: string;
  /** 종일 이벤트 여부 */
  isAllDay: boolean;
  /** 가시성 설정 */
  visibility: EventVisibility;
  /** 마지막 수정 시간 (ISO 8601) */
  updatedAt?: string;
  /** 반복 규칙 (RRULE) */
  recurrence?: string;
}

/** 동기화 매핑 - 어떤 이벤트가 어디로 동기화되었는지 추적 */
export interface SyncMapping {
  /** 원본 캘린더 이벤트 ID */
  sourceId: string;
  /** 원본 캘린더 */
  source: CalendarSource;
  /** 대상 캘린더 이벤트 ID */
  targetId: string;
  /** 대상 캘린더 */
  target: CalendarSource;
  /** 마지막 동기화 시간 */
  lastSyncedAt: string;
  /** 원본 이벤트의 수정 시간 (변경 감지용) */
  sourceUpdatedAt?: string;
}

/** 동기화 결과 */
export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: SyncError[];
}

export interface SyncError {
  sourceId: string;
  source: CalendarSource;
  target: CalendarSource;
  message: string;
}

/** 캘린더 클라이언트 인터페이스 */
export interface CalendarClient {
  /** 클라이언트 이름 */
  readonly name: CalendarSource;

  /** 지정 기간의 이벤트 목록 조회 */
  getEvents(from: string, to: string): Promise<CalendarEvent[]>;

  /** 이벤트 생성 (생성된 이벤트 ID 반환) */
  createEvent(event: CalendarEvent, visibility: EventVisibility): Promise<string>;

  /** 이벤트 업데이트 */
  updateEvent(targetId: string, event: CalendarEvent, visibility: EventVisibility): Promise<void>;

  /** 이벤트 삭제 */
  deleteEvent(targetId: string): Promise<void>;
}

/**
 * Dooray 클라우드 환경
 * - public:     민간 클라우드       (dooray.com)
 * - gov:        공공 클라우드       (gov-dooray.com)
 * - gov-kr:     공공 업무망 클라우드 (gov-dooray.co.kr)
 * - finance:    금융 클라우드       (dooray.co.kr)
 */
export type DoorayCloud = "public" | "gov" | "gov-kr" | "finance";

/** Dooray 설정 */
export interface DoorayConfig {
  /** Dooray 클라우드 환경 (기본값: gov) */
  cloud?: DoorayCloud;
  /** Dooray 테넌트 ID (Dooray URL의 서브도메인) */
  tenantId: string;
  /** Dooray CalDAV 아이디 (이메일) */
  username: string;
  /** Dooray CalDAV 전용 비밀번호 (Dooray 캘린더 > CalDAV 설정에서 발급) */
  password: string;
  /** Dooray API 토큰 (선택) */
  apiToken?: string;
  /** Dooray 멤버 ID (선택) */
  memberId?: string;
  /** 사용할 캘린더 이름 (선택, 미지정시 첫 번째 캘린더) */
  calendarName?: string;
}

/** Google Calendar 설정 */
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId?: string; // 기본값: "primary"
}

/** Apple Calendar 설정 */
export interface AppleConfig {
  username: string; // Apple ID
  appSpecificPassword: string;
  calendarName?: string;
}

/** 전체 설정 */
export interface PluginConfig {
  dooray: DoorayConfig;
  google?: GoogleConfig;
  apple?: AppleConfig;
  syncIntervalMinutes?: number;
}
