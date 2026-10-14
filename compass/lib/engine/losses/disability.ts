import type { PersonClaim } from "@/lib/schemas/person-claim";
import { ageOn } from "../dates";
import { atLeast, isPositive, lessThan } from "../decimal";
import { won } from "../range";
import { scale, type Rules } from "../rules";
import type { LossLine } from "../types";
import { hoffmanCoefficient, monthlyIncomeBasis } from "./earnings";
import { calculated, missing, needsCheck } from "./line";

// 후유장애 손해 항목: 위자료, 상실수익액. 대인배상 지급기준 "다. 후유장애".
// 가정간호비(노동능력상실률 100%의 식물인간·사지완전마비)는 계산하지 않는다.

type Band = { fromPercent: number; toPercent: number; amount: number };

function solatiumAmount(rate: string, age: number, rules: Rules, used: string[]): { amount: number; formula: string } | null {
  const threshold = rules.number("solatium.disability.highThresholdPercent", used);
  const ageThreshold = rules.number("solatium.ageThreshold", used);
  if (threshold === null || ageThreshold === null) return null;
  if (atLeast(rate, threshold)) {
    const baseAmount = rules.number(age < ageThreshold ? "solatium.disability.high.under" : "solatium.disability.high.over", used);
    const factor = rules.number("solatium.disability.high.factorPercent", used);
    if (baseAmount === null || factor === null) return null;
    const amount = scale(rules, used, baseAmount, [[rate, 100], [factor, 100]]);
    return amount === null ? null : { amount, formula: `${won(baseAmount)}(${age}세) × 노동능력상실률 ${rate}% × ${factor}% = ${won(amount)}` };
  }
  const bands = rules.list<Band>("solatium.disability.lowBands", used);
  const band = bands?.find((row) => atLeast(rate, row.fromPercent) && lessThan(rate, row.toPercent));
  if (!band) return null;
  return { amount: band.amount, formula: `노동능력상실률 ${rate}%(${band.fromPercent}% 이상 ${band.toPercent}% 미만) → ${won(band.amount)}` };
}

/** 부상 위자료와 겹칠 때의 처리는 손해 장부(loss-ledger.ts)가 한다. 여기서는 후유장애만의 금액을 낸다 */
export function disabilityLosses(person: PersonClaim, accidentDate: string, rules: Rules): LossLine[] {
  const disability = person.disability;
  if (disability === null) return [];
  const lines: LossLine[] = [];
  const from = disability.determinedOn ?? accidentDate;
  const rate = disability.lossRatePercent;
  const need = [
    ...(rate === null ? [{ field: "disability.lossRatePercent", message: "노동능력상실률을 입력하면 계산됩니다" }] : []),
    ...(person.birthDate === null ? [{ field: "birthDate", message: "생년월일을 입력하면 계산됩니다" }] : []),
  ];

  const solatium = { item: "solatium_disability", category: "disability" as const, label: "위자료(후유장애)", required: true };
  const earnings = { item: "lost_earnings_disability", category: "disability" as const, label: "상실수익액(후유장애)" };
  if (rate === null || person.birthDate === null) return [missing(solatium, need), missing(earnings, need)];
  if (!isPositive(rate)) return [calculated(solatium, 0, "노동능력상실률 0% → 0원"), calculated(earnings, 0, "노동능력상실률 0% → 0원")];

  {
    const used: string[] = [];
    const result = solatiumAmount(rate, ageOn(person.birthDate, from), rules, used);
    const overlap = rules.text("solatium.disability.overlap", used);
    if (result === null || overlap !== "larger_only") lines.push(needsCheck(solatium, "후유장애 위자료 기준을 확인하지 못했습니다", used));
    else lines.push(calculated(solatium, result.amount, result.formula, used));
  }

  {
    const used: string[] = [];
    const income = monthlyIncomeBasis(person, rules, used);
    const coefficient = hoffmanCoefficient(person.birthDate, from, rules, used);
    if (!income.ok) lines.push(needsCheck(earnings, income.text, used, income.flags));
    else if (!coefficient.ok) lines.push(needsCheck(earnings, coefficient.text, used));
    else {
      const amount = scale(rules, used, income.value, [[rate, 100], [coefficient.value, 1]]);
      lines.push(
        amount === null
          ? needsCheck(earnings, "원 미만 처리 방식을 확인하지 못했습니다", used)
          : calculated(earnings, amount, `${income.text} × 노동능력상실률 ${rate}% × ${coefficient.text} = ${won(amount)}`, used, income.flags),
      );
    }
  }
  return lines;
}
