import type { PersonClaim } from "@/lib/schemas/person-claim";
import { won } from "../range";
import { scale, type Rules } from "../rules";
import { NOTICES, type LossLine } from "../types";
import { calculated, missing, needsCheck, notApplicable } from "./line";

// 부상 손해 항목: 치료관계비, 향후치료비, 위자료, 휴업손해, 그 밖의 손해배상금(통원·식대), 간병비.
// 대인배상 지급기준 "나. 부상"의 항목이다. 자동차상해·무보험자동차상해도 같은 항목을 쓴다.

type Injury = NonNullable<PersonClaim["injury"]>;

function lostIncome(person: PersonClaim, injury: Injury, rules: Rules): LossLine {
  const b = { item: "lost_income", category: "injury" as const, label: "휴업손해" };
  const used: string[] = [];
  if (person.occupationType === null) return missing(b, [{ field: "occupationType", message: "직업을 입력하면 휴업손해가 계산됩니다" }]);
  const noLoss = rules.list<string>("lostIncome.noLossOccupations", used);
  const byWage = rules.list<string>("lostIncome.dailyWageOccupations", used);
  const rate = rules.number("lostIncome.payRatePercent", used);
  if (noLoss === null || byWage === null || rate === null) return needsCheck(b, "휴업손해 기준을 확인하지 못했습니다", used);
  if (noLoss.includes(person.occupationType)) return calculated(b, 0, "무직자·학생 등은 수입의 감소가 없는 것으로 봅니다 → 0원", used);
  if (injury.daysOffWork === null) return missing(b, [{ field: "injury.daysOffWork", message: "일을 쉰 날수를 입력하면 휴업손해가 계산됩니다" }], used);
  const daysOff = injury.daysOffWork;
  if (daysOff === 0) return calculated(b, 0, "일을 쉰 날이 없음 → 0원", used);

  if (byWage.includes(person.occupationType)) {
    const wage = rules.number("dailyWage.amount", used);
    if (wage === null) return needsCheck(b, `${NOTICES.daily_wage_required}: 가사종사자는 일용근로자 임금으로 계산합니다. 임금이 입력되면 더해집니다`, used, ["daily_wage_required"]);
    const amount = scale(rules, used, wage, [[daysOff, 1], [rate, 100]]);
    if (amount === null) return needsCheck(b, "원 미만 처리 방식을 확인하지 못했습니다", used);
    return calculated(b, amount, `일용근로자 임금 ${won(wage)} × ${daysOff}일 × ${rate}% = ${won(amount)}`, used);
  }

  // 1일 수입감소액을 직접 받았으면 그것을 쓰고, 아니면 월소득을 한 달 일수로 나눈다.
  let amount: number | null;
  let formula: string;
  if (injury.dailyIncomeLoss !== null) {
    amount = scale(rules, used, injury.dailyIncomeLoss, [[daysOff, 1], [rate, 100]]);
    formula = `1일 수입감소액 ${won(injury.dailyIncomeLoss)} × ${daysOff}일 × ${rate}%`;
  } else if (person.monthlyIncome !== null) {
    const monthDays = rules.number("lostIncome.daysPerMonth", used);
    if (monthDays === null) return needsCheck(b, "월소득을 1일 수입감소액으로 바꾸는 기준을 확인하지 못했습니다", used);
    amount = scale(rules, used, person.monthlyIncome, [[daysOff, monthDays], [rate, 100]]);
    formula = `월소득 ${won(person.monthlyIncome)} ÷ ${monthDays}일 × ${daysOff}일 × ${rate}%`;
  } else return missing(b, [{ field: "monthlyIncome", message: "월소득 또는 1일 수입감소액을 입력하면 휴업손해가 계산됩니다" }], used);
  if (amount === null) return needsCheck(b, "원 미만 처리 방식을 확인하지 못했습니다", used);

  // 수입 감소를 서류로 증명할 수 있는 경우에만 지급한다. 증명 여부를 모르거나 못 하면 예상은 0원, 최대는 증명했을 때의 금액이다.
  if (person.incomeProven === true) return calculated(b, amount, `${formula} = ${won(amount)}`, used);
  const line = calculated(b, { min: 0, expected: 0, max: amount }, `${formula} = ${won(amount)}. 수입 감소를 서류로 증명해야 지급됩니다(증명하지 못하면 0원)`, used);
  if (person.incomeProven === null) line.missing.push({ field: "incomeProven", message: "소득을 서류로 증명할 수 있는지 알려 주면 휴업손해가 정해집니다" });
  return line;
}

function nursing(injury: Injury, rules: Rules): LossLine {
  const b = { item: "nursing", category: "injury" as const, label: "간병비", guaranteed: true };
  const used: string[] = [];
  const maxGrade = rules.number("nursing.maxGrade", used);
  if (injury.grade === null) return missing(b, [{ field: "injury.grade", message: "상해급수를 고르면 간병비 대상인지 알 수 있습니다" }], used);
  if (maxGrade === null) return needsCheck(b, "간병비 인정 대상 기준을 확인하지 못했습니다", used);
  if (injury.grade > maxGrade) return notApplicable(b, `간병비는 상해 1~${maxGrade}급만 인정합니다`, used);
  if (injury.nursingProven === null) return missing(b, [{ field: "injury.nursingProven", message: "간병을 증명할 서류가 있는지 알려 주면 간병비가 계산됩니다" }], used);
  if (!injury.nursingProven) return notApplicable(b, "간병비는 객관적인 증빙자료를 낸 경우에만 인정합니다", used);
  if (injury.hospitalDays === null) return missing(b, [{ field: "injury.hospitalDays", message: "입원일수를 입력하면 간병비가 계산됩니다" }], used);
  const maxDays = rules.number(`nursing.maxDays.grade${injury.grade}`, used);
  const wage = rules.number("dailyWage.amount", used);
  if (maxDays === null) return needsCheck(b, "간병비 인정일수를 확인하지 못했습니다", used);
  if (wage === null) return needsCheck(b, `${NOTICES.daily_wage_required}: 간병비는 1일 일용근로자 임금으로 계산합니다. 임금이 입력되면 더해집니다`, used, ["daily_wage_required"]);
  const days = Math.min(injury.hospitalDays, maxDays);
  return calculated(b, wage * days, `일용근로자 임금 ${won(wage)} × ${days}일(입원 ${injury.hospitalDays}일, 인정 한도 ${maxDays}일) = ${won(wage * days)}`, used);
}

export function injuryLosses(person: PersonClaim, rules: Rules): LossLine[] {
  const injury = person.injury;
  if (injury === null) return [];
  const lines: LossLine[] = [];

  const medical = { item: "medical", category: "injury" as const, label: "치료관계비", required: true, medical: true, guaranteed: true };
  lines.push(
    injury.treatmentCost === null
      ? missing(medical, [{ field: "injury.treatmentCost", message: "치료비를 입력하면 계산됩니다" }])
      : calculated(medical, injury.treatmentCost, `실제 치료비 ${won(injury.treatmentCost)}`),
  );

  const future = { item: "future_medical", category: "injury" as const, label: "향후치료비" };
  lines.push(
    injury.futureTreatmentCost === null
      ? missing(future, [{ field: "injury.futureTreatmentCost", message: "향후치료비를 입력하면 더해집니다(없으면 0)" }])
      : calculated(future, { min: 0, expected: injury.futureTreatmentCost, max: injury.futureTreatmentCost }, `입력한 추정액 ${won(injury.futureTreatmentCost)}. 인정되지 않으면 0원`),
  );

  const solatium = { item: "solatium_injury", category: "injury" as const, label: "위자료(부상)", required: true };
  if (injury.grade === null) lines.push(missing(solatium, [{ field: "injury.grade", message: "상해급수를 고르면 계산됩니다" }]));
  else {
    const used: string[] = [];
    const amount = rules.number(`solatium.injury.grade${injury.grade}`, used);
    lines.push(amount === null ? needsCheck(solatium, "급별 위자료를 확인하지 못했습니다", used) : calculated({ ...solatium, label: `위자료(부상 ${injury.grade}급)` }, amount, `${injury.grade}급 위자료 ${won(amount)}`, used));
  }

  lines.push(lostIncome(person, injury, rules));

  const outpatient = { item: "outpatient", category: "injury" as const, label: "그 밖의 손해배상금(통원)" };
  if (injury.outpatientDays === null) lines.push(missing(outpatient, [{ field: "injury.outpatientDays", message: "통원일수를 입력하면 더해집니다" }]));
  else {
    const used: string[] = [];
    const perDay = rules.number("incidental.outpatientPerDay", used);
    lines.push(
      perDay === null
        ? needsCheck(outpatient, "통원 1일 금액을 확인하지 못했습니다", used)
        : calculated(outpatient, perDay * injury.outpatientDays, `통원 ${injury.outpatientDays}일 × ${won(perDay)} = ${won(perDay * injury.outpatientDays)}`, used),
    );
  }

  const meals = { item: "meals", category: "injury" as const, label: "그 밖의 손해배상금(입원 식대)", medical: true, guaranteed: true };
  if (injury.mealsNotProvided === null) lines.push(missing(meals, [{ field: "injury.mealsNotProvided", message: "입원 중 병원 식사를 받지 않은 끼니 수를 입력하면 더해집니다(없으면 0)" }]));
  else {
    const used: string[] = [];
    const perMeal = rules.number("incidental.mealPerMeal", used);
    lines.push(
      perMeal === null
        ? needsCheck(meals, "식대 한 끼 금액을 확인하지 못했습니다", used)
        : calculated(meals, perMeal * injury.mealsNotProvided, `${injury.mealsNotProvided}끼 × ${won(perMeal)} = ${won(perMeal * injury.mealsNotProvided)}`, used),
    );
  }

  lines.push(nursing(injury, rules));
  return lines;
}
