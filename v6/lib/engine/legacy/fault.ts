// 이식 원본: compass/lib/engine/fault.ts 1–108행 전체 (compass 커밋 e58ffd1). 바꾼 것: import 경로만.
// MASTER.md 6장 이식 로직(부록 A). 아직 v6 엔진에 연결하지 않았다.
import type { Limit, PersonClaim } from "./schemas/person-claim";
import { blockers, guaranteedCost, hasCategory, lossByCategory, medicalCost, total } from "./loss-ledger";
import { won } from "./range";
import { scale, type Rules } from "./rules";
import { CATEGORY_LABELS, combine, type Step } from "./steps";
import { CATEGORIES, type ByCategory, type Computation, type Ledger, type MissingInfo, type Scenario } from "./types";

// 과실상계와 그 예외(<별표4> 과실상계 등).
// - 과실상계 뒤 금액이 치료관계비와 간병비의 합보다 적으면 치료관계비(식대 포함)와 간병비를 보상한다("치료비 보장").
// - 다만 12~14급 상해를 입은 차량운전자는, 상계 전 치료관계비가 대인배상Ⅰ 한도를 넘는 부분에 본인 과실비율만큼을 부담한다.

/** 계산에 필요한 것 한 묶음 */
export type Claim = { person: PersonClaim; accidentDate: string; ledger: Ledger; rules: Rules };

/** 과실상계: 금액 × (100 − 과실비율) / 100 */
export function afterFault(rules: Rules, used: string[], amount: number, faultPercent: number) {
  return scale(rules, used, amount, [[100 - faultPercent, 100]]);
}

/** 손해 장부나 과실비율이 모자라면 그 이유를 돌려준다 */
export function liabilityBlocker(claim: Claim): Computation | null {
  const { missing, needsCheck } = blockers(claim.ledger);
  const all: MissingInfo[] = [...missing];
  if (claim.person.faultPercent === null) all.push({ field: "faultPercent", message: "과실비율을 입력하면 계산됩니다" });
  if (all.length > 0) return { ok: false, status: "insufficient_info", missing: all, ruleIds: [], reason: "정보 부족" };
  if (needsCheck.length > 0) return { ok: false, status: "needs_check", missing: [], ruleIds: needsCheck.flatMap((line) => line.ruleIds), reason: needsCheck[0].formula };
  return null;
}

/**
 * 대인배상Ⅱ와 무보험자동차상해가 함께 쓰는 계산: 사망·부상·후유장애를 합한 금액을 과실상계하고,
 * 치료비 보장을 적용한 뒤, 대인배상Ⅰ에서 지급될 수 있는 금액과 이미 받은 금액을 빼고, 가입금액까지 지급한다.
 */
export function excessOverCompulsory(claim: Claim, compulsory: (scenario: Scenario) => ByCategory, limit: Limit, alreadyReceived: number, limitLabel: string): Computation {
  const { person, ledger, rules } = claim;
  const blocked = liabilityBlocker(claim);
  if (blocked) return blocked;
  const fault = person.faultPercent as number;
  const used: string[] = [];
  const flags: string[] = [];
  const floorOn = rules.flag("fault.medicalFloor", used);
  const minorGrades = rules.list<number>("fault.minorInjuryGrades", used);
  if (floorOn === null || minorGrades === null) return { ok: false, status: "needs_check", missing: [], ruleIds: used, reason: "과실상계 기준을 확인하지 못했습니다" };

  // 경상환자 규정은 12~14급 차량운전자에게만 적용한다. 운전자인지 모르면 최소에서만 적용한다.
  const grade = person.injury?.grade ?? null;
  const minor = grade !== null && minorGrades.includes(grade);
  const compulsoryInjuryLimit = minor ? rules.number(`liability1.injury.limit.grade${grade}`, used) : null;
  if (minor && compulsoryInjuryLimit === null) return { ok: false, status: "needs_check", missing: [], ruleIds: used, reason: "대인배상Ⅰ 상해급별 한도를 확인하지 못했습니다" };
  if (minor && person.vehicleDriver === null) flags.push("minor_injury_driver_unknown");

  return combine(
    (scenario) => {
      const loss = lossByCategory(ledger, scenario);
      const sum = total(loss);
      const offset = afterFault(rules, used, sum, fault);
      if (offset === null) return null;
      const steps: Step[] = [{ item: "after_fault", label: "과실상계 후", value: offset, formula: `손해액 합계 ${won(sum)} × (100 − ${fault})% = ${won(offset)}`, ruleIds: ["fault.medicalFloor"] }];

      let payable = offset;
      const guaranteed = guaranteedCost(ledger, scenario);
      if (floorOn && offset < guaranteed) {
        let floor = guaranteed;
        let formula = `과실상계 후 금액이 치료관계비·간병비 ${won(guaranteed)}보다 적어 ${won(guaranteed)}을 보장`;
        const medical = medicalCost(ledger, scenario);
        const asDriver = person.vehicleDriver === true || (person.vehicleDriver === null && scenario === "min");
        if (minor && asDriver && compulsoryInjuryLimit !== null && medical > compulsoryInjuryLimit) {
          const share = scale(rules, used, medical - compulsoryInjuryLimit, [[fault, 100]]);
          if (share === null) return null;
          floor = guaranteed - share;
          formula = `치료관계비·간병비 ${won(guaranteed)} − 경상환자 본인 부담 (${won(medical)} − 대인배상Ⅰ 한도 ${won(compulsoryInjuryLimit)}) × ${fault}% = ${won(floor)}`;
        }
        payable = Math.max(offset, floor);
        steps.push({ item: "medical_floor", label: "치료비 보장 적용 후", value: payable, formula, ruleIds: ["fault.medicalFloor", ...(minor ? ["fault.minorInjuryGrades"] : [])] });
      } else steps.push({ item: "medical_floor", label: "치료비 보장 적용 후", value: payable, formula: "과실상계 후 금액이 치료관계비·간병비 이상이라 그대로", ruleIds: ["fault.medicalFloor"] });

      const paidByCompulsory = compulsory(scenario);
      const deducted = Math.max(0, payable - total(paidByCompulsory) - alreadyReceived);
      steps.push({
        item: "minus_compulsory",
        label: "대인배상Ⅰ 등 공제 후",
        value: deducted,
        formula: `${won(payable)} − 대인배상Ⅰ에서 지급될 수 있는 금액 ${won(total(paidByCompulsory))}${alreadyReceived > 0 ? ` − 이미 받은 금액 ${won(alreadyReceived)}` : ""} = ${won(deducted)}`,
        ruleIds: [],
      });
      const paid = limit === "unlimited" ? deducted : Math.min(deducted, limit);
      steps.push({ item: "limit", label: "지급 예상액", value: paid, formula: `${limitLabel} ${limit === "unlimited" ? "무한" : won(limit)} 이내 → ${won(paid)}`, ruleIds: [] });

      // 지급액을 부상 → 후유장애 → 사망 순서로 나눠 적는다(자동차상해의 구분별 공제에 쓴다).
      const byCategory: ByCategory = { injury: 0, disability: 0, death: 0 };
      let left = paid;
      const present = CATEGORIES.filter((category) => hasCategory(ledger, category));
      for (const category of present) {
        const share = afterFault(rules, used, loss[category], fault);
        if (share === null) return null;
        const uplift = category === "injury" ? payable - offset : 0;
        const room = category === present[present.length - 1] ? left : Math.min(left, Math.max(0, share + uplift - paidByCompulsory[category]));
        byCategory[category] = room;
        left -= room;
      }
      return { byCategory, steps };
    },
    used,
    flags,
  );
}

export { CATEGORY_LABELS };
