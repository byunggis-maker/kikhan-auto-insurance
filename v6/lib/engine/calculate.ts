import { STANDARDS_EDITION, editionFor, latestEdition } from "@/lib/claim/editions";
import { paymentLabel } from "@/lib/claim/payer";
import { ACCIDENT_BURDEN, BASIS_TEXT, COMPULSORY, STANDARDS_AS_OF, compulsoryRuleItems, dailyWageFor } from "@/lib/claim/standards";
import { positionOf, type Claim, type Coverage, type InsuranceStatus, type Limit, type Policy, type PolicyCoverage, type Property, type Victim } from "@/lib/claim/types";
import { allocate, autoInjury, compulsoryBodily, excess, minorInjuryShare, ownDamagePay, propertyLiability, selfInjury, won, type Paid } from "./adjust";
import { capToLoss } from "./dedupe";
import { checkExclusions, type Exclusions } from "./exclusions";
import faultFile from "./legacy/data/fault.json";
import { makeDeduction } from "./legacy/deduction";
import { afterFault, type Claim as LegacyClaim } from "./legacy/fault";
import { lossByCategory } from "./legacy/loss-ledger";
import { openRules, scale, type Rules } from "./legacy/rules";
import type { LiableInsurance, PersonClaim } from "./legacy/schemas/person-claim";
import { ruleFileSchema, type RuleItem } from "./legacy/schemas/rules";
import type { ByCategory } from "./legacy/types";
import { verificationNotice } from "./legacy/verification";
import { personLoss, propertyLoss } from "./losses";
import { withVerifiedProductLines } from "./rule-verification";
import type { Run, RunBurden, RunCard, RunLine, RunNote, Side, ValueMode } from "./types";

/** 라운드 9c: 앱이 계산하지 않는 경우의 표시 문구(0원 대신 '미계산') */
export const UNCALCULATED = {
  family: "상대 보험 대인배상Ⅱ 가족 면책 가능 — 대인배상Ⅰ 범위 확인 필요 (앱에서 미계산)",
  government: "정부보장사업 청구 대상 (앱에서 미계산)",
} as const;

const VERIFICATION_TEXT = "이 보험 종류의 약관과 대조하지 않은 계산 기준이 들어 있습니다. 보험사에 확인하세요.";

// MASTER.md 6장 계산 엔진. 사람 한 명·물건 한 개 단위로, 보상담당자의 순서대로 계산한다.
//   (1) 면책·제한(exclusions.ts) → (2) 담보 매칭(아래 각 카드 함수) → (3) 손해액 정리(losses.ts)
//   → (4) 지급액 조정(adjust.ts, legacy 이식 로직) → (5) 중복 차감(뒤 순위 = min(한도, 실제손해 − 앞 순위), dedupe.ts)
// 이 파일은 한 번의 실행(확정만 또는 추정 포함)을 계산한다. 두 실행을 합치는 것은 dual-run.ts다.

const FAULT_ITEMS: RuleItem[] = ruleFileSchema.parse(faultFile).items;
export const RULE_ITEMS: RuleItem[] = [...withVerifiedProductLines(FAULT_ITEMS), ...compulsoryRuleItems()];

const FAMILY_FOR_BODILY2 = ["self", "spouse", "parent", "child"] as const;
const SCOPE_EXCLUDED = "운전자 범위 위반: 이 담보는 보상하지 않습니다";

function coverageOf(policy: Policy | null, coverage: Coverage): PolicyCoverage | undefined {
  return policy?.coverages.find((entry) => entry.coverage === coverage);
}

function toLegacyStatus(status: InsuranceStatus): LiableInsurance["status"] {
  return status === "uninsured" ? "none" : status;
}

export function runOnce(claim: Claim, faultPercent: number, mode: ValueMode): Run {
  const ex: Exclusions = checkExclusions(claim.accident);
  // 사고일에 시행 중인 약관 판을 고른다(결정 기록 D-21). 등록된 판이 없으면 최신 판으로 계산하고 알린다.
  const accidentDate = claim.accident.occurredAt?.slice(0, 10) ?? null;
  const matched = accidentDate === null ? null : editionFor(accidentDate);
  const edition = { id: (matched ?? latestEdition()).id, matched: matched !== null };
  const empty: Run = { lines: [], notes: [], burdens: [], cards: [], notices: [], blocked: ex.blocked, edition };
  if (ex.blocked) return empty;

  const f = faultPercent;
  const date = claim.accident.occurredAt?.slice(0, 10) ?? STANDARDS_AS_OF;
  const rules: Rules = openRules(RULE_ITEMS, date < STANDARDS_AS_OF ? STANDARDS_AS_OF : date);
  const my = claim.myPolicy;
  const cp = claim.counterpartyPolicy;
  const cpStatus: InsuranceStatus = claim.accident.type === "single" || cp === null ? "no_counterparty" : cp.status;
  const hasCounterparty = cpStatus !== "no_counterparty";
  const productLine = my.productLine ?? "personal";

  const lines: RunLine[] = [];
  const notes: RunNote[] = [];
  const burdens: RunBurden[] = [];
  const cards: RunCard[] = [];
  const notices: string[] = [];
  if (accidentDate === null) notices.push(`사고일을 몰라 최신 약관 판(${edition.id} 개정) 기준으로 계산했습니다.`);
  else if (!matched)
    notices.push(`${edition.id} 개정 약관 기준으로 계산했습니다. 사고일(${accidentDate})에 시행되던 약관과 내용이 다를 수 있으니 보험사에 확인하세요.`);
  if (edition.id !== STANDARDS_EDITION) notices.push(`금액 기준은 ${STANDARDS_EDITION} 개정 약관의 금액으로 계산했습니다. 보험사에 확인하세요.`);
  if (my.productLine === null) notices.push("내 보험 종류를 몰라 개인용 약관 기준으로 계산했습니다.");

  // 내가 낸 사고부담금·배상책임의 합계를 위해 내 보험 지급액을 모은다.
  let myBodily1Total = 0;
  let myBodily2Total = 0;
  let myPropertyTotal = 0;

  function makeLine(cardId: string, coverage: Coverage, whose: Side, status: RunLine["status"], amount: number, formula: string, basis: string, flags: string[] = [], ruleIds: string[] = []): RunLine {
    const label = paymentLabel(coverage, whose, cpStatus);
    const notice = verificationNotice(RULE_ITEMS, ruleIds, productLine);
    return {
      key: `${cardId}:${coverage}:${label.payer}`,
      cardId,
      coverage,
      label: label.label,
      payer: label.payer,
      status,
      amount: status === "paid" ? amount : 0,
      formula,
      basis: label.basis ? `${basis} / ${label.basis}` : basis,
      // 사용자에게는 규칙 id 대신 일반 안내를 보인다(legacy/verification.ts의 표시 문구는 개발용)
      flags: notice ? [...flags, VERIFICATION_TEXT] : flags,
    };
  }
  function fromPaid(cardId: string, coverage: Coverage, whose: Side, paid: Paid, basis: string, flags: string[] = []): RunLine {
    if (!paid.ok) return makeLine(cardId, coverage, whose, "needs_input", 0, paid.reason, basis, flags);
    return makeLine(cardId, coverage, whose, "paid", paid.amount, paid.formula, basis, [...flags, ...paid.flags], paid.ruleIds);
  }

  function legacyPerson(victim: Victim, fault: number, vehicleDriver: boolean | null): PersonClaim {
    return {
      id: victim.id,
      label: victim.label,
      age: victim.age,
      faultPercent: fault,
      occupationType: null,
      monthlyIncome: null,
      incomeProven: null,
      vehicleDriver,
      injury: { grade: victim.injuryGrade, treatmentCost: null, futureTreatmentCost: null, hospitalDays: null, outpatientDays: null, daysOffWork: null, dailyIncomeLoss: null, mealsNotProvided: null, nursingProven: null },
      death: victim.died ? { date } : null,
      disability: victim.disabilityGrade === null ? null : { lossRatePercent: null, grade: victim.disabilityGrade, determinedOn: null },
      receivedFromThirdParty: 0,
      receivedFromLiableParty: 0,
    };
  }

  const injuryLimitFor = (grade: number | null) => (grade === null ? null : (COMPULSORY.injuryLimits.value[grade] ?? null));

  // ── 사람 카드 ──
  function person(victim: Victim) {
    const loss = personLoss(victim, mode, date);
    if (loss.details.some((d) => d.formula.includes("일용근로자 임금 "))) {
      const wage = dailyWageFor(date);
      if (wage) notices.push(`일용근로자 임금 ${wage.value.toLocaleString("ko-KR")}원으로 계산했습니다: ${wage.formula}.`);
    }
    const side: Side = victim.role === "counterparty" ? "counterparty" : "mine";
    cards.push({ cardId: victim.id, label: victim.label, kind: "person", side, actualLoss: loss.actualLoss, missing: loss.missing, notes: loss.notes, details: loss.details });
    const legacy = (fault: number, vehicleDriver: boolean | null): LegacyClaim => ({ person: legacyPerson(victim, fault, vehicleDriver), accidentDate: date, ledger: loss.ledger, rules });
    const out: RunLine[] = [];
    const id = victim.id;

    if (victim.role === "counterparty") {
      // 상대방 → 내 대인배상Ⅰ·Ⅱ. 피해자 측 과실 = 100 − 내 과실
      if (f === 0) {
        out.push(makeLine(id, "liability_bodily_1", "mine", "excluded", 0, "내 과실 0%라 상대방에게 배상책임이 없습니다", BASIS_TEXT.bodily1Fault));
      } else {
        const c = legacy(100 - f, victim.vehicleDriver);
        const surcharge = "보험료 할증 안내: 내 대인배상으로 지급하면 다음 계약 보험료가 오를 수 있습니다";
        const b1 = compulsoryBodily(c);
        out.push(fromPaid(id, "liability_bodily_1", "mine", b1.paid, BASIS_TEXT.bodily1Fault, [surcharge]));
        const full = excess(c, b1.at, "unlimited", 0, "대인배상Ⅱ 가입금액").paid;
        const b2Coverage = coverageOf(my, "liability_bodily_2");
        if (full.ok) {
          if (ex.outsideScope || !b2Coverage) {
            out.push(makeLine(id, "liability_bodily_2", "mine", "excluded", 0, ex.outsideScope ? SCOPE_EXCLUDED : "대인배상Ⅱ에 가입하지 않았습니다", ex.outsideScope ? BASIS_TEXT.driverScope : BASIS_TEXT.excessFault));
            if (full.amount > 0) burdens.push({ key: `${id}:bodily2_uncovered`, label: `${victim.label}: 대인배상Ⅱ로 보상되지 않는 배상책임`, amount: full.amount, formula: full.formula, basis: ex.outsideScope ? BASIS_TEXT.driverScope : BASIS_TEXT.excessFault });
          } else {
            const limit: Limit = b2Coverage.limit ?? "unlimited";
            const paid = limit === "unlimited" ? full.amount : Math.min(full.amount, limit);
            out.push(makeLine(id, "liability_bodily_2", "mine", "paid", paid, `${full.formula}${limit === "unlimited" ? "" : ` → 내 대인배상Ⅱ 가입금액 ${won(limit)} 이내 ${won(paid)}`}`, BASIS_TEXT.excessFault, b2Coverage.limit === null ? ["대인배상Ⅱ 가입금액 확인 필요(무한으로 계산)"] : [], full.ruleIds));
            if (full.amount > paid) burdens.push({ key: `${id}:bodily2_over_limit`, label: `${victim.label}: 대인배상Ⅱ 한도 초과분`, amount: full.amount - paid, formula: `${won(full.amount)} − 가입금액 ${won(paid)}`, basis: BASIS_TEXT.excessFault });
          }
        } else out.push(fromPaid(id, "liability_bodily_2", "mine", full, BASIS_TEXT.excessFault));
        const share = minorInjuryShare(c, injuryLimitFor(victim.injuryGrade));
        if (share > 0)
          notes.push({ key: `${id}:minor_share`, cardId: id, label: "경상 본인 부담분", amount: share, text: `상대방(경상 ${victim.injuryGrade}급 차량운전자)의 본인 과실분 치료비 ${won(share)}은 상대방의 자동차상해·자기신체사고에서 처리합니다`, basis: BASIS_TEXT.excessFault });
      }
      // 라운드 9b: 상대 차량의 동승자는 상대 운전자 과실분(100 − 내 과실)%을 상대 차량의 대인배상에서도 받는다(공동불법행위, 내 차 남 동승자와 같은 나눔)
      // 라운드 9c: 상대 차량이 무보험·뺑소니이거나 상대 운전자의 가족 동승자이면 상대 쪽은 계산하지 않고 '미계산'으로 둔다(0원으로 보이지 않게)
      const seat = victim.seat;
      if (positionOf(victim) === "counterparty_vehicle" && (seat === "passenger" || seat === "passenger_family") && f < 100) {
        if (cpStatus === "uninsured" || cpStatus === "hit_and_run") out.push(makeLine(id, "liability_bodily_1", "counterparty", "not_implemented", 0, UNCALCULATED.government, BASIS_TEXT.government));
        else if (seat === "passenger_family") out.push(makeLine(id, "liability_bodily_1", "counterparty", "not_implemented", 0, UNCALCULATED.family, BASIS_TEXT.familyBodily2));
        else if (cpStatus === "unknown") out.push(makeLine(id, "liability_bodily_1", "counterparty", "needs_input", 0, "상대 차량의 보험 가입 여부를 입력하면 계산됩니다", BASIS_TEXT.bodily1Fault));
        else if (cpStatus === "full" || cpStatus === "mandatory_only") {
          const own = legacy(f, false);
          const b1 = compulsoryBodily(own);
          out.push(fromPaid(id, "liability_bodily_1", "counterparty", b1.paid, BASIS_TEXT.bodily1Fault, ["상대 차량 동승자: 상대 운전자 과실분은 상대 차량 보험에서 받습니다(어느 한쪽 보험사에 전액 청구할 수 있습니다)"]));
          if (cpStatus === "full") out.push(fromPaid(id, "liability_bodily_2", "counterparty", excess(own, b1.at, coverageOf(cp, "liability_bodily_2")?.limit ?? "unlimited", 0, "상대 대인배상Ⅱ 가입금액").paid, BASIS_TEXT.excessFault));
        }
      }
      const capped = capToLoss(out, loss.actualLoss);
      for (const line of capped) {
        if (line.payer !== "own_insurer") continue;
        if (line.coverage === "liability_bodily_1") myBodily1Total += line.amount;
        if (line.coverage === "liability_bodily_2") myBodily2Total += line.amount;
      }
      lines.push(...capped);
      return;
    }

    // ① 상대 차량의 대인배상(내 차 쪽 사람). 피해자 측 과실 = 내 과실
    //    가족 동승자는 피해자 측 과실로, 남 동승자는 공동불법행위 분담으로 상대 과실분만 상대 보험에 둔다(ASSUMPTIONS.passengerSplitByFault).
    const isDriver = victim.role === "driver";
    // 가족 동승자: 운전자 과실을 피해자 측 과실로 빼므로 상대 보험은 상대 과실분만 준다(결정 기록 D-22)
    const familyNotice = () => {
      const rest = coverageOf(my, "auto_injury") ? "자동차상해" : coverageOf(my, "self_injury") ? "자기신체사고" : null;
      return `상대 보험은 상대 과실분(${100 - f}%)만 지급합니다(운전자 과실을 피해자 측 과실로 뺌). 나머지는 내 대인Ⅰ${rest ? `·${rest}` : ""}에서 받습니다`;
    };
    const c = legacy(f, isDriver ? victim.vehicleDriver : false);
    let counterpartyPaid = 0;
    let bodily1Raw: ReturnType<typeof compulsoryBodily> | null = null;
    let bodily2Raw: ReturnType<typeof excess> | null = null;
    let uninsuredRaw: ReturnType<typeof excess> | null = null;
    if (hasCounterparty) {
      if (f === 100) out.push(makeLine(id, "liability_bodily_1", "counterparty", "excluded", 0, "내 과실 100%라 상대방에게 배상책임이 없습니다", BASIS_TEXT.bodily1Fault));
      else if (cpStatus === "unknown") out.push(makeLine(id, "liability_bodily_1", "counterparty", "needs_input", 0, "상대 차량의 보험 가입 여부를 입력하면 계산됩니다", BASIS_TEXT.bodily1Fault));
      else {
        bodily1Raw = compulsoryBodily(c);
        out.push(fromPaid(id, "liability_bodily_1", "counterparty", bodily1Raw.paid, BASIS_TEXT.bodily1Fault, victim.role === "other_passenger" ? ["어느 한쪽 보험사에 전액 청구할 수 있습니다(공동 배상)"] : victim.role === "family_passenger" ? [familyNotice()] : []));
        if (cpStatus === "full") {
          const b2Limit: Limit = coverageOf(cp, "liability_bodily_2")?.limit ?? "unlimited";
          bodily2Raw = excess(c, bodily1Raw.at, b2Limit, 0, "상대 대인배상Ⅱ 가입금액");
          out.push(fromPaid(id, "liability_bodily_2", "counterparty", bodily2Raw.paid, BASIS_TEXT.excessFault, coverageOf(cp, "liability_bodily_2")?.limit == null ? ["상대 대인배상Ⅱ 가입금액 확인 필요(무한으로 계산)"] : []));
        }
        if (isDriver) {
          const share = minorInjuryShare(c, injuryLimitFor(victim.injuryGrade));
          if (share > 0)
            notes.push({ key: `${id}:minor_share`, cardId: id, label: "경상 본인 부담분", amount: share, text: `경상(${victim.injuryGrade}급) 차량운전자 본인 과실분 치료비 ${won(share)}은 내 자동차상해·자기신체사고에서 처리합니다`, basis: BASIS_TEXT.excessFault });
        }
      }
      counterpartyPaid = out.reduce((sum, line) => sum + line.amount, 0);
    }

    // ② 내 보험의 대인배상(동승자)
    let myBodilyPaid = 0;
    if (!isDriver) {
      const remaining = Math.max(0, loss.actualLoss - counterpartyPaid);
      const r = victim.rideAlongReductionPercent;
      const afterRide = r > 0 ? (scale(rules, [], remaining, [[100 - r, 100]]) ?? remaining) : remaining;
      const rideText = r > 0 ? ` × (100 − 호의동승 ${r}%) = ${won(afterRide)}` : "";
      const rideFlags = r > 0 ? [`검토 필요: 호의동승 감액 ${r}%(별표5)`] : [];
      const base = compulsoryBodily(legacy(0, false)).paid;
      if (!base.ok) out.push(fromPaid(id, "liability_bodily_1", "mine", base, BASIS_TEXT.bodily1Fault));
      else {
        const b1 = Math.min(base.amount, afterRide);
        out.push(makeLine(id, "liability_bodily_1", "mine", "paid", b1, `실제손해 ${won(loss.actualLoss)} − 상대 보험 ${won(counterpartyPaid)} = ${won(remaining)}${rideText} → 대인배상Ⅰ 한도 내 ${won(base.amount)} 중 ${won(b1)}`, BASIS_TEXT.bodily1Fault, rideFlags, base.ruleIds));
        myBodilyPaid += b1;
        const family = victim.role === "family_passenger" && (FAMILY_FOR_BODILY2 as readonly string[]).includes(victim.relationToNamedInsured ?? "");
        const b2Coverage = coverageOf(my, "liability_bodily_2");
        if (family) out.push(makeLine(id, "liability_bodily_2", "mine", "excluded", 0, "기명피보험자(피보험자)의 부모·배우자·자녀는 내 대인배상Ⅱ에서 보상하지 않습니다", BASIS_TEXT.familyBodily2));
        else if (b2Coverage) {
          const want = Math.max(0, afterRide - b1);
          if (ex.outsideScope) {
            out.push(makeLine(id, "liability_bodily_2", "mine", "excluded", 0, SCOPE_EXCLUDED, BASIS_TEXT.driverScope));
            if (want > 0) burdens.push({ key: `${id}:bodily2_uncovered`, label: `${victim.label}: 대인배상Ⅱ로 보상되지 않는 배상책임`, amount: want, formula: `${won(afterRide)} − 대인배상Ⅰ ${won(b1)}`, basis: BASIS_TEXT.driverScope });
          } else {
            const limit: Limit = b2Coverage.limit ?? "unlimited";
            const b2 = limit === "unlimited" ? want : Math.min(want, limit);
            out.push(makeLine(id, "liability_bodily_2", "mine", "paid", b2, `${won(afterRide)} − 대인배상Ⅰ ${won(b1)} = ${won(want)} → 가입금액 ${limit === "unlimited" ? "무한" : won(limit)} 이내 ${won(b2)}`, BASIS_TEXT.excessFault, rideFlags));
            myBodilyPaid += b2;
          }
        }
      }
    }

    // ③ 내 무보험자동차상해(상대가 책임보험만·무보험·뺑소니)
    const uninsuredCoverage = coverageOf(my, "uninsured");
    const uninsuredApplies = hasCounterparty && f < 100 && (cpStatus === "mandatory_only" || cpStatus === "uninsured" || cpStatus === "hit_and_run");
    const familyInsured = isDriver || (victim.role === "family_passenger" && (FAMILY_FOR_BODILY2 as readonly string[]).includes(victim.relationToNamedInsured ?? ""));
    if (uninsuredApplies && familyInsured && bodily1Raw) {
      if (!uninsuredCoverage) notices.push(`${victim.label}: 무보험자동차상해에 가입하지 않아 상대 차량 쪽은 ${cpStatus === "mandatory_only" ? "상대 대인배상Ⅰ" : "정부보장사업(대인Ⅰ 상당액)"}까지만 받습니다.`);
      else if (ex.outsideScope) out.push(makeLine(id, "uninsured", "mine", "excluded", 0, SCOPE_EXCLUDED, BASIS_TEXT.driverScope));
      else {
        uninsuredRaw = excess(c, bodily1Raw.at, uninsuredCoverage.limit ?? "unlimited", 0, "무보험자동차상해 가입금액");
        out.push(fromPaid(id, "uninsured", "mine", uninsuredRaw.paid, BASIS_TEXT.uninsured, uninsuredCoverage.limit === null ? ["무보험자동차상해 가입금액 확인 필요(무한으로 계산)"] : []));
      }
    }

    // ④ 내 자동차상해(대인배상Ⅱ의 피보험자와 그 부모·배우자·자녀) 또는 자기신체사고
    const auto = coverageOf(my, "auto_injury");
    const self = coverageOf(my, "self_injury");
    // 자동차상해·자기신체사고가 함께 쓰는 공제액(자동차상해 특별약관 2.(2)③, 보통약관 제16조①3호: 같은 항목)
    const deductionAmounts = (): ByCategory => {
      if (isDriver) {
        // 앞 순위 공제액: legacy makeDeduction(compass coordinate.ts deductionFor)
        const noLiableParty = !hasCounterparty ? "상대 차량이 없는 사고입니다" : f === 100 ? "내 과실이 100%입니다" : null;
        const { deductionFor } = makeDeduction({
          claim: c,
          liable: { status: toLegacyStatus(cpStatus), bodily2Limit: coverageOf(cp, "liability_bodily_2")?.limit ?? (cpStatus === "full" ? "unlimited" : null) },
          noLiableParty,
          uninsuredApplies,
          ownUninsured: uninsuredCoverage ? { limit: uninsuredCoverage.limit ?? "unlimited" } : null,
          bodily1: bodily1Raw?.raw ?? null,
          bodily2: bodily2Raw?.raw ?? null,
          uninsured: uninsuredRaw?.raw ?? null,
        });
        return deductionFor("expected").amounts;
      }
      // 동승자: 상대 보험 + 내 대인배상 지급액을 구분 순서대로 공제
      return allocate(lossByCategory(loss.ledger, "expected"), counterpartyPaid + myBodilyPaid);
    };
    if (familyInsured && auto) {
      if (ex.outsideScope) out.push(makeLine(id, "auto_injury", "mine", "excluded", 0, SCOPE_EXCLUDED, BASIS_TEXT.driverScope));
      else {
        const injuryLimit = auto.injuryLimit ?? auto.limit;
        const deathLimit = auto.deathLimit ?? auto.disabilityLimit ?? auto.limit;
        if (injuryLimit === null || deathLimit === null) out.push(makeLine(id, "auto_injury", "mine", "needs_input", 0, "자동차상해 가입금액을 입력하면 계산됩니다", BASIS_TEXT.autoInjury));
        else out.push(fromPaid(id, "auto_injury", "mine", autoInjury(c, deductionAmounts(), injuryLimit, deathLimit), BASIS_TEXT.autoInjury));
      }
    } else if (familyInsured && self) {
      if (ex.outsideScope) out.push(makeLine(id, "self_injury", "mine", "excluded", 0, SCOPE_EXCLUDED, BASIS_TEXT.driverScope));
      else if (typeof self.injuryLimit !== "number") out.push(makeLine(id, "self_injury", "mine", "needs_input", 0, "자기신체사고 부상 가입금액(1,500만·3,000만·5,000만원)을 입력하면 계산됩니다", BASIS_TEXT.selfInjury));
      else {
        const num = (value: Limit | null) => (typeof value === "number" ? value : null);
        const paid = selfInjury(c, deductionAmounts(), { injury: self.injuryLimit, death: num(self.deathLimit), disability: num(self.disabilityLimit) }, { injury: victim.injuryGrade, disability: victim.disabilityGrade });
        out.push(fromPaid(id, "self_injury", "mine", paid, BASIS_TEXT.selfInjury));
      }
    }

    const capped = capToLoss(out, loss.actualLoss);
    for (const line of capped) if (line.payer === "own_insurer" && line.coverage === "liability_bodily_1") myBodily1Total += line.amount;
    for (const line of capped) if (line.payer === "own_insurer" && line.coverage === "liability_bodily_2") myBodily2Total += line.amount;
    lines.push(...capped);
  }

  // ── 물건 카드 ──
  function property(item: Property) {
    const loss = propertyLoss(item, mode);
    const side: Side = item.role === "my_vehicle" ? "mine" : "counterparty";
    cards.push({ cardId: item.id, label: item.label, kind: "property", side, actualLoss: loss.total, missing: loss.missing, notes: loss.notes, details: loss.details });
    const id = item.id;
    const out: RunLine[] = [];

    if (item.role === "my_vehicle") {
      let recoveredTotal = 0;
      if (hasCounterparty) {
        if (f === 100) out.push(makeLine(id, "liability_property", "counterparty", "excluded", 0, "내 과실 100%라 상대방에게 배상책임이 없습니다", BASIS_TEXT.property));
        else if (cpStatus === "uninsured" || cpStatus === "hit_and_run") out.push(makeLine(id, "liability_property", "counterparty", "excluded", 0, "상대 차량이 무보험·뺑소니라 대물배상이 없고, 정부보장사업은 사람의 손해만 보상합니다", BASIS_TEXT.government));
        else if (cpStatus === "unknown") out.push(makeLine(id, "liability_property", "counterparty", "needs_input", 0, "상대 차량의 보험 가입 여부를 입력하면 계산됩니다", BASIS_TEXT.property));
        else {
          const limit = coverageOf(cp, "liability_property")?.limit;
          const numeric = typeof limit === "number" ? limit : cpStatus === "mandatory_only" ? COMPULSORY.propertyLimit.value : null;
          if (numeric === null) out.push(makeLine(id, "liability_property", "counterparty", "needs_input", 0, "상대 대물배상 가입금액을 입력하면 계산됩니다", BASIS_TEXT.property));
          else {
            const paid = propertyLiability(rules, loss.total, f, numeric);
            out.push(fromPaid(id, "liability_property", "counterparty", paid, BASIS_TEXT.property));
            if (paid.ok) recoveredTotal = paid.amount;
          }
        }
      }
      const own = coverageOf(my, "own_damage");
      if (own) {
        const base = (loss.byCode.repair ?? 0) + (loss.byCode.replacement_value ?? 0) + (loss.byCode.towing ?? 0);
        const limit = typeof own.limit === "number" ? own.limit : item.valueAtAccident;
        if (ex.outsideScope) out.push(makeLine(id, "own_damage", "mine", "excluded", 0, SCOPE_EXCLUDED, BASIS_TEXT.driverScope));
        else if (ex.ownDamage === "excluded") out.push(makeLine(id, "own_damage", "mine", "excluded", 0, `${ex.burdenReasons.join("·")}: 보험계약자·기명피보험자·30일 초과 임차인·동거 친족이 운전했으므로 자기차량손해는 보상하지 않습니다`, BASIS_TEXT.ownDamageDui));
        else if (base === 0) out.push(makeLine(id, "own_damage", "mine", "needs_input", 0, "수리비(또는 전손 가액)를 입력하면 계산됩니다", BASIS_TEXT.ownDamage));
        else if (limit === null || my.deductible === null) out.push(makeLine(id, "own_damage", "mine", "needs_input", 0, limit === null ? "자기차량손해 가입금액(차량가액)을 입력하면 계산됩니다" : "자기부담금 조건을 입력하면 계산됩니다", BASIS_TEXT.ownDamage));
        else {
          const used: string[] = [];
          const share = hasCounterparty && f < 100 ? (afterFault(rules, used, base, f) ?? 0) : 0;
          const recovered = Math.min(share, recoveredTotal);
          const vehicle = { id, label: item.label, ownerId: id, faultPercent: f, repairCost: loss.byCode.repair ?? null, totalLoss: loss.byCode.replacement_value !== undefined, valueAtAccident: item.valueAtAccident, extendedRepairCap: null, firstRegisteredOn: item.firstRegisteredOn, commercialUse: item.commercialUse, rental: null, idle: null, towingCost: loss.byCode.towing ?? null };
          const paid = ownDamagePay(rules, vehicle, base, limit, my.deductible, recovered);
          let line = fromPaid(id, "own_damage", "mine", paid, BASIS_TEXT.ownDamage);
          if (ex.ownDamage === "relation_unknown")
            line = { ...line, flags: [...line.flags, "운전자 관계 확인 필요"], alternative: { label: "운전자가 보험계약자·기명피보험자·30일 초과 임차인·동거 친족이면 면책(제23조 14호)", amount: 0 } };
          out.push(line);
        }
      }
      lines.push(...capToLoss(out, loss.total));
      return;
    }

    // 상대 차·물건 → 내 대물배상. 피해자 측 과실 = 100 − 내 과실
    const coverage = coverageOf(my, "liability_property");
    if (f === 0) out.push(makeLine(id, "liability_property", "mine", "excluded", 0, "내 과실 0%라 상대방에게 배상책임이 없습니다", BASIS_TEXT.property));
    else if (!coverage || typeof coverage.limit !== "number") out.push(makeLine(id, "liability_property", "mine", "needs_input", 0, "내 대물배상 가입금액을 입력하면 계산됩니다", BASIS_TEXT.property));
    else {
      const used: string[] = [];
      const offset = afterFault(rules, used, loss.total, 100 - f) ?? 0;
      if (ex.outsideScope) {
        // 운전자 범위 위반: 약관대로 대인배상Ⅰ만 보상하고 대물배상은 0원(결정 기록 D-15). 배상책임 전액이 내게 남는다.
        out.push(makeLine(id, "liability_property", "mine", "excluded", 0, SCOPE_EXCLUDED, BASIS_TEXT.driverScope));
        if (offset > 0)
          burdens.push({ key: `${id}:property_uncovered`, label: `${item.label}: 대물로 보상 안 되는 배상책임`, amount: offset, formula: `손해액 ${won(loss.total)} × (100 − ${100 - f})% = ${won(offset)}`, basis: BASIS_TEXT.driverScope });
      } else {
        const paid = propertyLiability(rules, loss.total, 100 - f, coverage.limit);
        out.push(fromPaid(id, "liability_property", "mine", paid, BASIS_TEXT.property));
        const amount = paid.ok ? paid.amount : 0;
        myPropertyTotal += amount;
        if (offset > amount)
          burdens.push({ key: `${id}:property_over_limit`, label: `${item.label}: 대물배상 한도를 넘는 배상책임`, amount: offset - amount, formula: `과실상계 후 ${won(offset)} − 대물배상 지급 ${won(amount)}`, basis: BASIS_TEXT.property });
      }
    }
    lines.push(...capToLoss(out, loss.total));
  }

  for (const victim of claim.victims) person(victim);
  for (const item of claim.properties) property(item);

  // ── 사고부담금(내가 낼 돈): 보통약관 제11조 ──
  if (ex.burden) {
    const reason = ex.burdenReasons.join("·");
    if (myBodily1Total > 0) burdens.push({ key: "burden:bodily1", label: `사고부담금(${reason}) 대인배상Ⅰ`, amount: myBodily1Total, formula: `대인배상Ⅰ 한도 내 지급보험금 ${won(myBodily1Total)}`, basis: `${ACCIDENT_BURDEN.basis.source} 1호` });
    if (myBodily2Total > 0) {
      const amount = Math.min(myBodily2Total, ACCIDENT_BURDEN.bodily2PerAccident);
      burdens.push({ key: "burden:bodily2", label: `사고부담금(${reason}) 대인배상Ⅱ`, amount, formula: `min(지급보험금 ${won(myBodily2Total)}, 1사고당 ${won(ACCIDENT_BURDEN.bodily2PerAccident)})`, basis: `${ACCIDENT_BURDEN.basis.source} 2호` });
    }
    if (myPropertyTotal > 0) {
      const mandatory = COMPULSORY.propertyLimit.value;
      const low = Math.min(myPropertyTotal, mandatory);
      const high = Math.min(Math.max(0, myPropertyTotal - mandatory), ACCIDENT_BURDEN.propertyOverMandatoryPerAccident);
      burdens.push({
        key: "burden:property",
        label: `사고부담금(${reason}) 대물배상`,
        amount: low + high,
        formula: `의무한도 ${won(mandatory)} 이하 지급보험금 ${won(low)} + 초과분 min(${won(Math.max(0, myPropertyTotal - mandatory))}, ${won(ACCIDENT_BURDEN.propertyOverMandatoryPerAccident)}) ${won(high)}`,
        basis: `${ACCIDENT_BURDEN.basis.source} 3호`,
      });
    }
  }

  return { lines, notes, burdens, cards, notices, blocked: null, edition };
}
