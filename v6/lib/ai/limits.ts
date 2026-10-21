// 라운드 8 비용 보호(로그인 없는 공개 앱). 서류 인식·음성 API는 IP당 하루 20회까지만 제공자를 부른다.
// - 횟수는 두 API를 합쳐 센다. 하루는 한국 시간 0시에 바뀐다.
// - 서버 메모리에만 센다(인스턴스마다 따로, 다시 시작하면 처음부터). 남은 위험은 docs/reports/round-8.md에 적었다.
// - IP는 횟수를 세는 데만 쓰고 로그·응답에 남기지 않는다.
// 업로드 크기: 한 건 10MB, 한 번에 5건은 화면에서 고를 때 막는다(lib/ui/upload.ts). 서버로는 한 요청에 한 건만 보낸다.

import { NO_STORE } from "./anthropic";

export const DAILY_AI_LIMIT = 20;
export const DAILY_LIMIT_MESSAGE = "오늘 사용 횟수를 다 쓰셨어요. 직접 입력해 주세요";

const counts = new Map<string, number>();
let countsDay = "";

/** 한국 시간 날짜(YYYY-MM-DD) */
export function seoulDay(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Vercel이 붙여 주는 x-forwarded-for의 첫 값(접속한 기기). 없으면 x-real-ip, 그것도 없으면 "unknown" 한 칸으로 센다 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** 한 번 쓴다. 오늘 이미 한도를 다 썼으면 false(세지 않음) */
export function takeDailyUse(ip: string, now = new Date()): boolean {
  const day = seoulDay(now);
  if (day !== countsDay) {
    counts.clear();
    countsDay = day;
  }
  const used = counts.get(ip) ?? 0;
  if (used >= DAILY_AI_LIMIT) return false;
  counts.set(ip, used + 1);
  return true;
}

/** 오늘 한도를 다 썼다. 라우트가 limitedResponse로 바꾼다 */
export class LimitError extends Error {}

/** 제공자를 부르는 함수를 감싸, 실제로 부를 때만 한 번 센다(입력 오류로 끝난 요청은 세지 않는다) */
export function counted<A extends unknown[], R>(ip: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args) => {
    if (!takeDailyUse(ip)) return Promise.reject(new LimitError());
    return fn(...args);
  };
}

/** 테스트에서만 쓴다 */
export function resetDailyUses(): void {
  counts.clear();
  countsDay = "";
}

/** 한도를 넘었을 때(429). 화면은 message를 보여 주고 직접 입력으로 돌린다 */
export function limitedResponse(): Response {
  return Response.json({ ok: false, reason: "limited", message: DAILY_LIMIT_MESSAGE }, { status: 429, headers: NO_STORE });
}
