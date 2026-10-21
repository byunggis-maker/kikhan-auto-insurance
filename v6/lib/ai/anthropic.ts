// MASTER.md 9장: 서버 전용 Claude 호출(ANTHROPIC_API_KEY, 기본 모델 claude-sonnet-5-5). 호출 코드는 라운드 7에서 넣는다.
// 키 원칙(라운드 6b 지시 4, 결정 기록 D-36): 키는 Vercel 환경변수와 v6/.env.local에만 둔다(.env*는 .gitignore). 코드·채팅에 값을 쓰지 않는다.
// 키가 없으면 그 기능만 "준비 중"을 돌려주고, 나머지 앱(입력·계산·검토서·저장)은 키 없이 그대로 동작한다.

export const AI_MODEL = "claude-sonnet-5-5";

export const AI_UNAVAILABLE_MESSAGE = "이 기능은 준비 중입니다. 직접 입력해 주세요.";

/** 서버에서만 부른다. 브라우저 코드에서는 process.env에 키가 없다 */
export function hasApiKey(env: Record<string, string | undefined> = process.env): boolean {
  return typeof env.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.trim() !== "";
}

/** AI 기능을 쓸 수 없을 때 라우트가 돌려줄 응답(503). 화면은 message를 그대로 보여 주고 직접 입력으로 돌린다 */
export function unavailableResponse(): Response {
  return Response.json({ ok: false, reason: "unavailable", message: AI_UNAVAILABLE_MESSAGE }, { status: 503 });
}
