import { ACCIDENT_TYPE_LABELS, COVERAGE_LABELS, DRIVER_SCOPE_LABELS, PRODUCT_LINE_LABELS, type Claim, type Limit } from "@/lib/claim/types";
import type { Review } from "@/lib/report/review";
import { ASSUMPTION_TEXT, counterpartyVehicle, periodCheck, type withAssumptions } from "./flow";

// 라운드 9: 약관 질의에 함께 보낼 사고 사실. 지금 입력된 값과 앱 계산 결과를 글로 정리한다(개인정보는 없다: 이름·번호를 받지 않는다).

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const limitText = (l: Limit | null) => (l === null ? "모름" : l === "unlimited" ? "무한" : won(l));
const yn = (v: boolean | null) => (v === true ? "예" : v === false ? "아니오" : "모름");
const STATUS: Record<string, string> = { full: "종합보험", mandatory_only: "책임보험만", uninsured: "무보험", hit_and_run: "뺑소니(상대를 모름)", no_counterparty: "상대 없음", unknown: "모름" };

export function askFacts(claim: Claim, assumed: ReturnType<typeof withAssumptions>["assumptions"], review: Review): string {
  const my = claim.myPolicy;
  const lines: string[] = [];
  const check = periodCheck(claim);
  lines.push(`사고일: ${claim.accident.occurredAt ?? "모름"}${my.periodStart && my.periodEnd ? ` (보험기간 ${my.periodStart} ~ ${my.periodEnd}, ${check === "inside" ? "기간 안" : check === "outside" ? "기간 밖" : "점검 불가"})` : ""}`);
  lines.push(`사고 유형: ${claim.accident.type ? ACCIDENT_TYPE_LABELS[claim.accident.type] : "모름"}`);
  lines.push(`내 보험: ${my.insurer || "보험회사 모름"} ${my.productLine ? PRODUCT_LINE_LABELS[my.productLine] : "종류 모름"}, 운전자 범위 ${my.driverScope ? DRIVER_SCOPE_LABELS[my.driverScope] : "모름"}${my.ageLimit ? `, 연령 한정 ${my.ageLimit}` : ""}`);
  const coverages = my.coverages.map((c) => {
    const split = c.injuryLimit !== null || c.deathLimit !== null;
    return `${COVERAGE_LABELS[c.coverage]} ${split ? `부상 ${limitText(c.injuryLimit)}·사망/후유장애 ${limitText(c.deathLimit)}` : c.coverage === "liability_bodily_1" ? "" : limitText(c.limit)}`.trim();
  });
  if (!my.coverages.some((c) => c.coverage === "liability_bodily_1")) coverages.unshift("대인배상Ⅰ");
  if (my.deductible?.type === "rate") coverages.push(`자기차량손해 자기부담금 ${my.deductible.ratePercent}%(최저 ${won(my.deductible.min)}, 최고 ${won(my.deductible.max)})`);
  lines.push(`가입담보·금액: ${coverages.join(", ")}`);
  if (my.vehicleValue) lines.push(`내 차 차량가액(증권): ${won(my.vehicleValue)}`);
  lines.push(`과실비율: ${claim.fault.mode === "known" ? `피보험자(나) ${claim.fault.myPercent}% : 상대 ${100 - claim.fault.myPercent}%` : "모름(0·30·50·70% 네 경우로 계산)"}`);
  const v = claim.accident.violations;
  lines.push(`사고 당시: 음주 ${yn(v.drunk)}, 무면허 ${yn(v.unlicensed)}, 마약·약물 ${yn(v.drugs)}, 조치의무 위반(뺑소니) ${yn(v.fledScene)}, 운전자 범위 밖 운전 ${yn(v.outsideDriverScope)}, 고의 ${yn(v.intentional)}`);
  for (const p of claim.victims) lines.push(`다친 사람 ${p.label}: 상해 급별 ${p.injuryGrade ? `${p.injuryGrade}급` : "모름"}, ${p.died ? "사망" : p.disabilityGrade ? `후유장애 ${p.disabilityGrade}급` : "부상"}`);
  for (const p of claim.properties) lines.push(`부서진 물건 ${p.label}${p.valueAtAccident !== null ? `: 사고 직전 가액 ${won(p.valueAtAccident)}(${p.valueSource === "estimate" ? "앱 추정" : "증권"})` : ""}`);
  if (counterpartyVehicle(claim)) {
    const cp = claim.counterpartyPolicy;
    lines.push(`상대 차량 보험: ${cp ? STATUS[cp.status] : "모름"}${cp && cp.status === "full" ? `, 대인배상Ⅱ ${limitText(cp.coverages.find((c) => c.coverage === "liability_bodily_2")?.limit ?? null)}, 대물배상 ${limitText(cp.coverages.find((c) => c.coverage === "liability_property")?.limit ?? null)}` : ""}`);
    for (const key of assumed) lines.push(`(추정) ${ASSUMPTION_TEXT[key]}`);
  }
  lines.push(`앱 계산 결과(내 과실 ${review.faultPercent}% 기준, 추정 포함): 받을 돈 ${won(review.top.receiveWithEstimates)}(확정 ${won(review.top.receiveConfirmed)}), 내가 낼 돈 ${won(review.top.burdenWithEstimates)}`);
  for (const card of review.cards)
    for (const line of card.lines) lines.push(`- ${card.label} ${line.label}(${line.payer}) ${line.status}: ${won(line.withEstimates)}${line.exclusion ? ` — ${line.exclusion}` : line.formula ? ` — ${line.formula}` : ""}`);
  return lines.join("\n").slice(0, 6000);
}
