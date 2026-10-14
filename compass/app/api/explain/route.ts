import { ApiError, failure, privateHeaders, sameOrigin } from "@/lib/guard/http";
import { paidGuard, type PaidPass } from "@/lib/guard/paid";
import { defaultExplanation, flagText } from "@/lib/explain/default";
import { explainCall, explainCell } from "@/lib/explain/llm";
import { readLlmConfig } from "@/lib/llm/structured";
import { resultFromClaim } from "@/lib/result/compute";
import { accidentClaimSchema } from "@/lib/schemas/accident-claim";
import { z } from "zod";

export const maxDuration = 60;

const inputSchema = z.object({ claim: accidentClaimSchema, rowId: z.string().min(1).max(100), columnId: z.string().min(1).max(200) }).strict();

// "왜 이 금액?"을 쉬운 말로 풀어 돌려준다. 유료 기능이라 문지기(paidGuard)를 거치고, 다친 내용이 들어가므로 건강정보 동의도 필요하다.
// 브라우저가 보낸 금액은 받지 않는다. 서버가 같은 엔진으로 다시 계산한 칸만 설명한다.
// 입력과 설명은 저장하지 않고 로그에도 남기지 않는다.
export async function POST(request: Request) {
  let pass: PaidPass | undefined;
  try {
    sameOrigin(request);
    pass = await paidGuard(request, "explain", ["service", "health"]);
    const text = await request.text();
    if (text.length > 100000) throw new ApiError(413, "TOO_LARGE", "요청이 너무 큽니다.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(400, "INVALID_INPUT", "입력값을 확인해 주세요.");
    }
    const input = inputSchema.parse(body);
    const { matrix } = resultFromClaim(input.claim);
    const cell = matrix.cells.find((candidate) => candidate.rowId === input.rowId && candidate.columnId === input.columnId);
    if (!cell) throw new ApiError(404, "NOT_FOUND", "설명할 칸을 찾지 못했습니다.");
    const label = matrix.columns.find((column) => column.id === cell.columnId)?.label ?? "담보";
    const fallback = defaultExplanation(cell, label);
    const config = readLlmConfig("LLM", process.env);
    const useLlm = config !== null && cell.status === "calculated";
    // LLM을 부르지 않으면 이용권 횟수를 깎지 않는다.
    if (!useLlm) await pass.refund();
    const sentences = useLlm ? await explainCell(cell, label, cell.flags.map(flagText), explainCall(config)) : null;
    // LLM 설명을 쓸 수 없으면(설정 없음, 실패, 숫자 검사에서 버림) 엔진의 내역으로 만든 기본 문장을 돌려준다.
    return Response.json(sentences ? { sentences, source: "llm" } : { sentences: fallback, source: "default" }, { headers: privateHeaders });
  } catch (error) {
    // 결과를 돌려주지 못했으면 이번에 깎은 횟수를 돌려준다.
    await pass?.refund();
    return failure(error);
  }
}
