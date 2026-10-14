import { z } from "zod";
import { jsonRoute } from "@/lib/guard/http";
import { issueTicket } from "@/lib/guard/paid";

// Turnstile 키가 없는 간이 모드에서는 화면이 빈 토큰을 보낸다. 키가 있으면 빈 토큰은 확인에서 거절된다.
const inputSchema = z.strictObject({ turnstileToken: z.string().max(2048) });

// 분석 이용권을 발급한다. Turnstile 확인과 하루 장수는 lib/guard/paid.ts의 issueTicket이 본다.
// 결제를 붙일 자리: 결제 확인 뒤 유료 이용권을 주는 경로는 이 옆에 따로 둔다(이번 단계에는 없다).
export async function POST(request: Request) {
  return jsonRoute(request, async (raw) => issueTicket(request, inputSchema.parse(raw).turnstileToken));
}
