/**
 * OpenClaw Dooray Calendar Sync Skill
 * 순수 JavaScript — voice-call 플러그인 형식 참조
 *
 * Dooray·Apple·Google 캘린더를 통합 동기화합니다.
 */

// MCP 표준 응답 포맷
function textResult(message) {
  return {
    content: [{ type: "text", text: message }],
  };
}

module.exports = {
  register(api) {
    var log = api && api.logger ? api.logger : console;
    log.info("[DoorayCalSync] register 시작");

    // config에서 설정 읽기
    var config = api.config || {};

    // 동기화 엔진 lazy 로드 (컴파일된 dist가 있을 때만)
    var engine = null;

    async function getEngine() {
      if (engine) return engine;
      try {
        var compiled = require("./dist/index.js");
        // initialize 함수가 있으면 호출
        if (compiled.initialize && config.dooray) {
          engine = await compiled.initialize(config);
          return engine;
        }
      } catch (e) {
        log.warn("[DoorayCalSync] dist 로드 실패 (빌드 필요?):", e.message);
      }
      return null;
    }

    // ── Tool 1: 캘린더 동기화 실행 ──
    api.registerTool({
      name: "calendar_sync",
      label: "Calendar Sync",
      description: "Dooray·Apple·Google 캘린더를 수동으로 동기화합니다.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_toolCallId, _params) {
        try {
          var eng = await getEngine();
          if (!eng) {
            return textResult(
              "⚠️ 캘린더 동기화 엔진이 초기화되지 않았습니다.\n\n" +
              "설정 필요:\n" +
              "1. openclaw.json에 dooray 설정 추가\n" +
              "2. npm run build 실행\n" +
              "3. openclaw restart"
            );
          }
          var result = await eng.sync();
          var lines = [
            "📅 캘린더 동기화 완료",
            "",
            "  ✅ 생성: " + result.created + "건",
            "  🔄 업데이트: " + result.updated + "건",
            "  🗑️ 삭제: " + result.deleted + "건",
          ];
          if (result.errors && result.errors.length > 0) {
            lines.push("  ⚠️ 오류: " + result.errors.length + "건");
          }
          return textResult(lines.join("\n"));
        } catch (err) {
          return textResult("❌ 캘린더 동기화 실패: " + err);
        }
      },
    });

    // ── Tool 2: 동기화 상태 확인 ──
    api.registerTool({
      name: "calendar_status",
      label: "Calendar Status",
      description: "캘린더 동기화 상태를 확인합니다.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_toolCallId, _params) {
        try {
          var eng = await getEngine();
          if (!eng) {
            return textResult(
              "📅 캘린더 동기화 상태\n─────────────────────────\n" +
              "⚠️ 동기화 엔진 미초기화\n\n" +
              "설정 상태:\n" +
              "  Dooray: " + (config.dooray ? "✅ 설정됨" : "❌ 미설정") + "\n" +
              "  Google: " + (config.google ? "✅ 설정됨" : "⬜ 선택사항") + "\n" +
              "  Apple: " + (config.apple ? "✅ 설정됨" : "⬜ 선택사항")
            );
          }
          var status = eng.getStatus();
          return textResult(status);
        } catch (err) {
          return textResult("❌ 상태 확인 실패: " + err);
        }
      },
    });

    log.info("[DoorayCalSync] 도구 2개 등록 완료");
  },
};
