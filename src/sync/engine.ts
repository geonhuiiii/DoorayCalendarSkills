import dayjs from "dayjs";
import {
  CalendarClient,
  CalendarEvent,
  CalendarSource,
  EventVisibility,
  SyncResult,
  SyncError,
} from "../types";
import { SyncStore } from "./store";

/**
 * 캘린더 동기화 엔진
 *
 * 핵심 규칙:
 * - Dooray 캘린더 일정 → Apple/Google에 "공개"로 동기화 (모든 사람이 내용을 볼 수 있음)
 * - Apple/Google 캘린더 일정 → Dooray 및 다른 캘린더에 "비공개"로 동기화 (나만 볼 수 있음)
 */
export class SyncEngine {
  private store: SyncStore;
  private clients: Map<CalendarSource, CalendarClient> = new Map();

  constructor(storagePath?: string) {
    this.store = new SyncStore(storagePath);
  }

  /** 캘린더 클라이언트 등록 */
  registerClient(client: CalendarClient): void {
    this.clients.set(client.name, client);
  }

  /**
   * 전체 동기화 실행
   *
   * 기본 동기화 범위: 오늘 기준 과거 7일 ~ 미래 90일
   */
  async sync(daysBack: number = 7, daysForward: number = 90): Promise<SyncResult> {
    const from = dayjs().subtract(daysBack, "day").toISOString();
    const to = dayjs().add(daysForward, "day").toISOString();

    const totalResult: SyncResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      errors: [],
    };

    // 모든 등록된 캘린더에서 이벤트 가져오기
    const allEvents = new Map<CalendarSource, CalendarEvent[]>();

    for (const [source, client] of this.clients) {
      try {
        const events = await client.getEvents(from, to);
        allEvents.set(source, events);
        console.log(`[${source}] ${events.length}개 이벤트 조회 완료`);
      } catch (err) {
        console.error(`[${source}] 이벤트 조회 실패:`, err);
        totalResult.errors.push({
          sourceId: "",
          source,
          target: source,
          message: `이벤트 조회 실패: ${err}`,
        });
      }
    }

    // 각 캘린더의 이벤트를 다른 모든 캘린더로 동기화
    for (const [source, events] of allEvents) {
      for (const [targetName, targetClient] of this.clients) {
        // 자기 자신에게는 동기화하지 않음
        if (targetName === source) continue;

        const visibility = this.getVisibility(source);
        const result = await this.syncEventsToTarget(
          events,
          source,
          targetClient,
          visibility
        );

        totalResult.created += result.created;
        totalResult.updated += result.updated;
        totalResult.deleted += result.deleted;
        totalResult.errors.push(...result.errors);
      }
    }

    // 삭제된 이벤트 정리
    const deleteResult = await this.cleanupDeletedEvents(allEvents);
    totalResult.deleted += deleteResult.deleted;
    totalResult.errors.push(...deleteResult.errors);

    console.log(
      `\n동기화 완료: 생성 ${totalResult.created}, 업데이트 ${totalResult.updated}, 삭제 ${totalResult.deleted}, 오류 ${totalResult.errors.length}`
    );

    return totalResult;
  }

  /**
   * 출처에 따른 가시성 결정
   *
   * - Dooray → "public" (공개: 모든 사람이 제목/내용을 볼 수 있음)
   * - Apple/Google → "private" (비공개: 나만 볼 수 있음)
   */
  private getVisibility(source: CalendarSource): EventVisibility {
    return source === "dooray" ? "public" : "private";
  }

  /**
   * 이벤트 목록을 대상 캘린더에 동기화
   */
  private async syncEventsToTarget(
    events: CalendarEvent[],
    source: CalendarSource,
    targetClient: CalendarClient,
    visibility: EventVisibility
  ): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, deleted: 0, errors: [] };
    const target = targetClient.name;

    for (const event of events) {
      try {
        const existing = this.store.findMapping(event.sourceId, source, target);

        if (existing) {
          // 이미 동기화된 이벤트 — 업데이트 필요한지 확인
          const needsUpdate =
            event.updatedAt &&
            existing.sourceUpdatedAt &&
            event.updatedAt !== existing.sourceUpdatedAt;

          if (needsUpdate) {
            await targetClient.updateEvent(existing.targetId, event, visibility);
            this.store.upsertMapping({
              ...existing,
              lastSyncedAt: new Date().toISOString(),
              sourceUpdatedAt: event.updatedAt,
            });
            result.updated++;
            console.log(
              `  [${source}→${target}] 업데이트: "${event.title}" (${visibility})`
            );
          }
        } else {
          // 새 이벤트 — 생성
          const targetId = await targetClient.createEvent(event, visibility);
          this.store.upsertMapping({
            sourceId: event.sourceId,
            source,
            targetId,
            target,
            lastSyncedAt: new Date().toISOString(),
            sourceUpdatedAt: event.updatedAt,
          });
          result.created++;
          console.log(
            `  [${source}→${target}] 생성: "${event.title}" (${visibility})`
          );
        }
      } catch (err) {
        result.errors.push({
          sourceId: event.sourceId,
          source,
          target,
          message: `${err}`,
        });
        console.error(
          `  [${source}→${target}] 오류: "${event.title}" — ${err}`
        );
      }
    }

    return result;
  }

  /**
   * 원본에서 삭제된 이벤트를 대상에서도 삭제
   */
  private async cleanupDeletedEvents(
    allEvents: Map<CalendarSource, CalendarEvent[]>
  ): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, deleted: 0, errors: [] };

    for (const [source, events] of allEvents) {
      const sourceIds = new Set(events.map((e) => e.sourceId));

      for (const [targetName, targetClient] of this.clients) {
        if (targetName === source) continue;

        const mappings = this.store.findMappingsByTarget(source, targetName);
        for (const mapping of mappings) {
          if (!sourceIds.has(mapping.sourceId)) {
            // 원본에서 삭제된 이벤트
            try {
              await targetClient.deleteEvent(mapping.targetId);
              this.store.removeMapping(mapping.sourceId, source, targetName);
              result.deleted++;
              console.log(
                `  [${source}→${targetName}] 삭제: sourceId=${mapping.sourceId}`
              );
            } catch (err) {
              result.errors.push({
                sourceId: mapping.sourceId,
                source,
                target: targetName,
                message: `삭제 실패: ${err}`,
              });
            }
          }
        }
      }
    }

    return result;
  }

  /** 현재 동기화 상태 요약 */
  getStatus(): string {
    const clientNames = Array.from(this.clients.keys()).join(", ");
    return [
      `연결된 캘린더: ${clientNames || "없음"}`,
      `동기화 매핑 수: ${this.store.count}`,
    ].join("\n");
  }
}
