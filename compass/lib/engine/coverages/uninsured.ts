import type { Limit } from "@/lib/schemas/person-claim";
import { excessOverCompulsory, type Claim } from "../fault";
import type { ByCategory, Computation, Scenario } from "../types";

// 무보험자동차에 의한 상해: 지급기준으로 산출한 금액(피보험자 과실상계 포함)에서
// 대인배상Ⅰ(정부보장사업 포함)에서 지급될 수 있는 금액과 배상의무자에게서 이미 받은 금액을 빼고, 가입금액까지 지급한다.
// 입력: 손해 장부, 과실비율, 대인배상Ⅰ 지급 가능액, 가입금액, 이미 받은 배상금. 출력: 구분별 지급액.

export function uninsuredMotorist(claim: Claim, bodily1: (scenario: Scenario) => ByCategory, limit: Limit, receivedFromLiableParty: number): Computation {
  return excessOverCompulsory(claim, bodily1, limit, receivedFromLiableParty, "무보험자동차상해 가입금액");
}
