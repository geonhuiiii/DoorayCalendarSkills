import * as fs from "fs";
import * as path from "path";
import { SyncMapping, CalendarSource } from "../types";

/**
 * 동기화 매핑 스토어
 *
 * 어떤 이벤트가 어느 캘린더로 동기화되었는지 추적합니다.
 * 로컬 JSON 파일에 저장합니다.
 */
export class SyncStore {
  private mappings: SyncMapping[] = [];
  private filePath: string;

  constructor(storagePath?: string) {
    this.filePath = storagePath ?? path.join(process.cwd(), ".sync-store.json");
    this.load();
  }

  /** 저장된 매핑 로드 */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.mappings = JSON.parse(raw);
      }
    } catch (err) {
      console.error("동기화 스토어 로드 실패:", err);
      this.mappings = [];
    }
  }

  /** 매핑 저장 */
  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.mappings, null, 2), "utf-8");
    } catch (err) {
      console.error("동기화 스토어 저장 실패:", err);
    }
  }

  /** 특정 원본→대상 매핑 조회 */
  findMapping(
    sourceId: string,
    source: CalendarSource,
    target: CalendarSource
  ): SyncMapping | undefined {
    return this.mappings.find(
      (m) => m.sourceId === sourceId && m.source === source && m.target === target
    );
  }

  /** 특정 대상 캘린더에 있는 모든 매핑 조회 */
  findMappingsByTarget(
    source: CalendarSource,
    target: CalendarSource
  ): SyncMapping[] {
    return this.mappings.filter(
      (m) => m.source === source && m.target === target
    );
  }

  /** 매핑 추가 또는 업데이트 */
  upsertMapping(mapping: SyncMapping): void {
    const idx = this.mappings.findIndex(
      (m) =>
        m.sourceId === mapping.sourceId &&
        m.source === mapping.source &&
        m.target === mapping.target
    );

    if (idx >= 0) {
      this.mappings[idx] = mapping;
    } else {
      this.mappings.push(mapping);
    }

    this.save();
  }

  /** 매핑 삭제 */
  removeMapping(
    sourceId: string,
    source: CalendarSource,
    target: CalendarSource
  ): void {
    this.mappings = this.mappings.filter(
      (m) =>
        !(m.sourceId === sourceId && m.source === source && m.target === target)
    );
    this.save();
  }

  /**
   * 이 이벤트가 동기화로 생성된 것인지 확인
   * (어떤 캘린더의 targetId로 등록되어 있으면 = 우리가 만든 것)
   */
  isSyncedEvent(eventId: string, calendar: CalendarSource): boolean {
    return this.mappings.some(
      (m) => m.targetId === eventId && m.target === calendar
    );
  }

  /** 동기화로 생성된 모든 targetId 집합 반환 */
  getSyncedTargetIds(calendar: CalendarSource): Set<string> {
    const ids = new Set<string>();
    for (const m of this.mappings) {
      if (m.target === calendar) {
        ids.add(m.targetId);
      }
    }
    return ids;
  }

  /** 전체 매핑 수 */
  get count(): number {
    return this.mappings.length;
  }
}
