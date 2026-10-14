import { z } from "zod";
import { ApiError, failure, privateHeaders, sameOrigin } from "@/lib/guard/http";
import { paidGuard, type PaidPass } from "@/lib/guard/paid";
import { MAX_ACCIDENT_TEXT, extractConfig, extractFacts, factsCall } from "@/lib/extract/accident";

export const maxDuration = 60;

const inputSchema = z.object({ text: z.string().trim().min(10).max(MAX_ACCIDENT_TEXT) }).strict();

/** 한국 시각의 오늘 날짜. "어제" 같은 말을 날짜로 바꿀 때 기준으로 알려 준다. */
function todayInKorea() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
}

// 사고 설명 글에서 사실을 뽑아 돌려준다. 다친 내용이 들어 있으므로 건강정보 동의가 있어야 한다.
// 글과 결과는 저장하지 않고 로그에도 남기지 않는다.
export async function POST(request: Request) {
  let pass: PaidPass | undefined;
  try {
    sameOrigin(request);
    pass = await paidGuard(request, "extract", ["service", "health"]);
    const raw = await request.text();
    if (raw.length > 20000) throw new ApiError(413, "TOO_LARGE", "요청이 너무 큽니다.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "INVALID_INPUT", "입력값을 확인해 주세요.");
    }
    const input = inputSchema.parse(body);
    const config = extractConfig();
    return Response.json({ facts: await extractFacts(input.text, todayInKorea(), factsCall(config)) }, { headers: privateHeaders });
  } catch (error) {
    // 결과를 돌려주지 못했으면 이번에 깎은 횟수를 돌려준다.
    await pass?.refund();
    return failure(error);
  }
}
