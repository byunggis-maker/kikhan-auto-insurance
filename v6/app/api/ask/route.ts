import { InputError, NO_STORE, hasApiKey, invalidResponse, unavailableResponse } from "@/lib/ai/anthropic";
import { MAX_FACTS, MAX_QUESTION, askTerms, claudeAsk, type AskCall } from "@/lib/ai/ask";
import { LimitError, clientIp, counted, limitedResponse } from "@/lib/ai/limits";
import { PRODUCT_LINES, type ProductLine } from "@/lib/claim/types";
import { LAW_INDEX, isStale, todaySeoul } from "@/lib/law/data";
import data from "@/lib/terms/data.json";
import type { TermsData } from "@/lib/terms/search";

export const maxDuration = 60;

// 라운드 9: 약관 질의(POST JSON { question, facts, productLine }). 서버에서만 ANTHROPIC_API_KEY를 쓴다.
// 약관 원문(lib/terms/data.json)에서 관련 쪽을 찾고, 앱에 든 법령 원문(data/laws)을 붙여 Claude에 묻는다.
// 질문·사고 사실·답변은 개인정보를 가리고, 저장하거나 로그에 남기지 않는다. 하루 한도는 서류 인식·음성과 합쳐 센다(lib/ai/limits.ts).
export async function POST(request: Request) {
  if (!hasApiKey()) return unavailableResponse();
  try {
    const body = (await request.json().catch(() => null)) as { question?: unknown; facts?: unknown; productLine?: unknown } | null;
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    const facts = typeof body?.facts === "string" ? body.facts : "";
    if (!question) throw new InputError(400, "질문을 적어 주세요.");
    if (question.length > MAX_QUESTION) throw new InputError(400, `질문은 ${MAX_QUESTION}자까지 적을 수 있어요.`);
    if (facts.length > MAX_FACTS) throw new InputError(400, "사고 정보가 너무 깁니다.");
    const productLine = (PRODUCT_LINES as readonly string[]).includes(body?.productLine as string) ? (body!.productLine as ProductLine) : null;
    const call = counted(clientIp(request), claudeAsk(process.env.ANTHROPIC_API_KEY!.trim())) as AskCall;
    // 라운드 9d: 법령은 앱에 든 원문(data/laws)만 쓴다. 외부 법령 API는 부르지 않는다
    const today = todaySeoul();
    const laws = LAW_INDEX.articles.map((a) => ({ ...a, stale: isStale(a.fetchedAt, today) }));
    const result = await askTerms({ question, facts, productLine }, { data: data as TermsData, laws, call });
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof InputError) return invalidResponse(error.status, error.message);
    if (error instanceof LimitError) return limitedResponse();
    return unavailableResponse();
  }
}
