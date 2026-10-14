import type { CaseDraft } from "@/lib/draft/types";
import { toClaim } from "@/lib/draft/to-claim";
import { calculateAccident } from "@/lib/engine/accident";
import { summarize, type Summary } from "@/lib/engine/summarize";
import type { Matrix, MissingInfo } from "@/lib/engine/types";
import { rulesFor } from "@/lib/rules/person-rules";
import { ENGINE_VERSION, RULES_VERSION } from "@/lib/rules/version";
import type { AccidentClaim } from "@/lib/schemas/accident-claim";

// 입력 초안으로 결과를 만든다. 브라우저와 서버가 같은 함수를 쓴다. 금액은 모두 엔진에서 나온다.

export type Result = { claim: AccidentClaim; matrix: Matrix; summary: Summary; rulesVersion: string; engineVersion: string };

export function resultFromClaim(claim: AccidentClaim): Result {
  const matrix = calculateAccident(claim, rulesFor(claim.productLine));
  return { claim, matrix, summary: summarize(matrix), rulesVersion: RULES_VERSION, engineVersion: ENGINE_VERSION };
}

export function computeResult(draft: CaseDraft): { ok: true; result: Result } | { ok: false; missing: MissingInfo[] } {
  const claim = toClaim(draft);
  return claim.ok ? { ok: true, result: resultFromClaim(claim.claim) } : claim;
}
