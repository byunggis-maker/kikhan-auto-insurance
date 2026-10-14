import { z } from "zod";
import { jsonRoute } from "@/lib/guard/http";
import { paidGuard } from "@/lib/guard/paid";
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
  return jsonRoute(request, async (raw) => {
    const input = inputSchema.parse(raw);
    await paidGuard(request, ["service", "health"]);
    const config = extractConfig();
    return { facts: await extractFacts(input.text, todayInKorea(), factsCall(config)) };
  });
}
