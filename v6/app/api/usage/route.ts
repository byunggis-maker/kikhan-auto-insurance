import { NO_STORE } from "@/lib/ai/anthropic";
import { DAILY_AI_LIMIT, clientIp, remainingDailyUses } from "@/lib/ai/limits";

// 라운드 8c: 오늘 남은 서류 인식·음성 횟수(IP당 하루 30회). 큰 PDF를 올리기 전에 "이 PDF는 ○회를 씁니다(오늘 남은 횟수 ○회)"에 쓴다.
// 세지 않고 보기만 한다. 서버 메모리에서 세므로 인스턴스마다 다를 수 있다(round-8.md 남은 위험).
export function GET(request: Request) {
  return Response.json({ ok: true, limit: DAILY_AI_LIMIT, remaining: remainingDailyUses(clientIp(request)) }, { headers: NO_STORE });
}
