import { STANDARD_BASIS } from "./lossItems";
import { COVERAGE_LABELS, type Coverage, type InsuranceStatus, type Payer } from "./types";

// 담보의 표시 이름과 지급처(상대 보험 | 내 보험 | 정부보장사업)를 정하는 v6 연결 계층.
// legacy/ 계산 코드는 "대인배상Ⅰ"이라는 이름으로 금액만 낸다. 누가 주는지와 화면에 보일 이름은 여기서 붙인다.

export type PaymentLabel = { coverage: Coverage; label: string; payer: Payer; basis: string | null };

/**
 * 누구의 보험 담보인지(whose)와 상대 차량의 보험 상태로 지급처를 정한다.
 * - 상대 차량이 무보험·뺑소니이면 대인배상Ⅰ에 해당하는 금액은 정부보장사업이 준다(자동차손해배상보장법 제30조).
 *   이때 이름은 "대인Ⅰ 상당액(정부보장사업)"이다.
 * - 상대 차량이 책임보험만 가입(mandatory_only)했으면 대인배상Ⅰ은 상대 보험이 준다.
 */
export function paymentLabel(coverage: Coverage, whose: "mine" | "counterparty", counterpartyStatus: InsuranceStatus): PaymentLabel {
  if (whose === "counterparty" && coverage === "liability_bodily_1" && (counterpartyStatus === "uninsured" || counterpartyStatus === "hit_and_run"))
    return { coverage, label: "대인Ⅰ 상당액(정부보장사업)", payer: "government", basis: STANDARD_BASIS.compulsoryBodilyByGovernment };
  return { coverage, label: COVERAGE_LABELS[coverage], payer: whose === "mine" ? "own_insurer" : "counterparty_insurer", basis: null };
}
