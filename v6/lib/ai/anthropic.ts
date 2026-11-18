// MASTER.md 9장: AI 기능의 설정과 공통 응답. 서버(API 라우트)에서만 쓴다.
// 키 원칙(라운드 6b 지시 4, 결정 기록 D-36): 키는 Vercel 환경변수와 v6/.env.local에만 둔다(.env*는 .gitignore). 코드·채팅·로그에 값을 쓰지 않는다.
// 키가 없거나 제공자 호출이 실패하면 그 기능만 503 "준비 중"을 돌려주고, 나머지 앱은 키 없이 그대로 동작한다.
// 키 이름은 V2(compass)와 같다: 서류 인식 ANTHROPIC_API_KEY, 음성 OPENAI_API_KEY + STT_MODEL.

type Env = Record<string, string | undefined>;

/** 서류 인식 모델(MASTER.md 9장 기본 모델) */
export const AI_MODEL = "claude-sonnet-5-5";
/** claude-sonnet-5-5 가격(1백만 토큰당 달러, 2026-10 기준). 건당 비용 추정에만 쓴다 */
export const AI_PRICE_PER_MTOK = { input: 2, output: 10 };

export const AI_UNAVAILABLE_MESSAGE = "이 기능은 준비 중입니다. 직접 입력해 주세요.";

const filled = (value: string | undefined) => typeof value === "string" && value.trim() !== "";

/** 서류 인식(Claude)을 쓸 수 있는지. 서버에서만 부른다(브라우저에는 키가 없다). 키가 만료됐으면(AI_KEY_EXPIRES) 쓸 수 없다 */
export function hasApiKey(env: Env = process.env, now = new Date()): boolean {
  return filled(env.ANTHROPIC_API_KEY) && keyState(env, now) !== "expired";
}

/** 키 만료 안내를 보여 주기 시작하는 날수(만료일 7일 전부터) */
export const KEY_NOTICE_DAYS = 7;
export const KEY_NOTICE = "문서 읽기·약관 질의 기능 점검 예정";

/**
 * 라운드 9b: 키 만료일(환경변수 AI_KEY_EXPIRES, YYYY-MM-DD, 한국 시간)과 오늘을 비교한다.
 * 만료일 당일까지는 쓸 수 있고(만료 7일 전부터 "soon"), 다음 날부터 "expired". 값이 없거나 모양이 틀리면 "ok"
 */
export function keyState(env: Env = process.env, now = new Date()): "ok" | "soon" | "expired" {
  const expires = env.AI_KEY_EXPIRES?.trim();
  if (!expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return "ok";
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (today > expires) return "expired";
  const days = (Date.parse(expires) - Date.parse(today)) / 86_400_000;
  return days <= KEY_NOTICE_DAYS ? "soon" : "ok";
}

/** 음성→문자(V2와 같은 OpenAI 전사 API)를 쓸 수 있는지 */
export function speechConfig(env: Env = process.env): { key: string; model: string } | null {
  return filled(env.OPENAI_API_KEY) && filled(env.STT_MODEL) ? { key: env.OPENAI_API_KEY!.trim(), model: env.STT_MODEL!.trim() } : null;
}

/** 쓸 수 없을 때(키 없음·제공자 실패) 라우트가 돌려줄 응답(503). 화면은 message를 보여 주고 직접 입력으로 돌린다 */
export function unavailableResponse(): Response {
  return Response.json({ ok: false, reason: "unavailable", message: AI_UNAVAILABLE_MESSAGE }, { status: 503, headers: NO_STORE });
}

/** 사용자가 고칠 수 있는 입력 오류(파일 없음·형식·크기 등) */
export function invalidResponse(status: number, message: string): Response {
  return Response.json({ ok: false, reason: "invalid", message }, { status, headers: NO_STORE });
}

/** 개인정보가 담긴 응답을 중간 저장소(CDN·브라우저 캐시)가 보관하지 않게 한다 */
export const NO_STORE = { "Cache-Control": "no-store" };

/** 사용자가 고칠 수 있는 입력 오류. 라우트가 invalidResponse로 바꾼다 */
export class InputError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 제공자 호출이 실패했다(키 오류·한도·거절·응답 모양 불일치). 라우트가 503 "준비 중"으로 바꾼다. 원문은 싣지 않는다 */
export class ProviderError extends Error {}

/** 건당 비용 추정(달러) */
export function estimateCost(usage: { inputTokens: number; outputTokens: number }): number {
  return (usage.inputTokens * AI_PRICE_PER_MTOK.input + usage.outputTokens * AI_PRICE_PER_MTOK.output) / 1_000_000;
}
