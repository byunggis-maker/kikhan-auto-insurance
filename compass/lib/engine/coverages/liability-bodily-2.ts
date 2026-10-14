import type { Limit } from "@/lib/schemas/person-claim";
import { excessOverCompulsory, type Claim } from "../fault";
import type { ByCategory, Computation, Scenario } from "../types";

// 대인배상Ⅱ: 지급기준으로 산출한 금액(과실상계 포함)에서 대인배상Ⅰ에서 지급되는 금액을 뺀 나머지를 가입금액까지 지급한다.
// 입력: 손해 장부, 과실비율, 대인배상Ⅰ 지급 예상액, 대인배상Ⅱ 가입금액("무한" 가능). 출력: 구분별 지급액.

export function liabilityBodily2(claim: Claim, bodily1: (scenario: Scenario) => ByCategory, limit: Limit): Computation {
  return excessOverCompulsory(claim, bodily1, limit, 0, "대인배상Ⅱ 가입금액");
}
