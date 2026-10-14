import type { PersonClaim } from "@/lib/schemas/person-claim";
import { birthRangeFromAge, overBirths } from "../age";
import { ageOn } from "../dates";
import { atLeast, isPositive, lessThan } from "../decimal";
import { rangeText, won } from "../range";
import { scale, type Rules } from "../rules";
import type { LossLine } from "../types";
import { hoffmanCoefficient, monthlyIncomeBasis } from "./earnings";
import { AGE_MISSING, ageNote } from "./death";
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
  const need = [...(rate === null ? [{ field: "disability.lossRatePercent", message: "노동능력상실률을 입력하면 계산됩니다" }] : []), ...(person.age === null ? [AGE_MISSING] : [])];

  const solatium = { item: "solatium_disability", category: "disability" as const, label: "위자료(후유장애)", required: true };
  const earnings = { item: "lost_earnings_disability", category: "disability" as const, label: "상실수익액(후유장애)" };
  if (rate === null || person.age === null) return [missing(solatium, need), missing(earnings, need)];
  if (!isPositive(rate)) return [calculated(solatium, 0, "노동능력상실률 0% → 0원"), calculated(earnings, 0, "노동능력상실률 0% → 0원")];
  const births = birthRangeFromAge(person.age, accidentDate);
  const age = person.age;

  {
    const used: string[] = [];
    const overlap = rules.text("solatium.disability.overlap", used);
    const result = overBirths<{ amount: number; formula: string }>(births, (birth) => {
      const found = solatiumAmount(rate, ageOn(birth, from), rules, used);
      return found === null ? { ok: false, text: "후유장애 위자료 기준을 확인하지 못했습니다" } : { ok: true, amount: found.amount, formula: found.formula };
    });
    if (!result.ok || overlap !== "larger_only") lines.push(needsCheck(solatium, "후유장애 위자료 기준을 확인하지 못했습니다", [...new Set(used)]));
    else lines.push(calculated(solatium, result.amount, result.amount.min === result.amount.max ? result.expected.formula : `${ageNote(age)}: 나이 기준 앞뒤라 ${rangeText(result.amount)}`, [...new Set(used)]));
  }

  {
    const used: string[] = [];
    const income = monthlyIncomeBasis(person, rules, used);
    if (!income.ok) lines.push(needsCheck(earnings, income.text, [...new Set(used)], income.flags));
    else {
      const result = overBirths<{ amount: number; coefficient: string }>(births, (birth) => {
        const coefficient = hoffmanCoefficient(birth, from, rules, used);
        if (!coefficient.ok) return coefficient;
        const amount = scale(rules, used, income.value, [[rate, 100], [coefficient.value, 1]]);
        return amount === null ? { ok: false, text: "원 미만 처리 방식을 확인하지 못했습니다" } : { ok: true, amount, coefficient: coefficient.text };
      });
      lines.push(
        !result.ok
          ? needsCheck(earnings, result.text, [...new Set(used)])
          : calculated(
              earnings,
              result.amount,
              `${ageNote(age)}. 예상: ${income.text} × 노동능력상실률 ${rate}% × ${result.expected.coefficient} = ${won(result.amount.expected)}${result.amount.min === result.amount.max ? "" : ` (생일에 따라 ${rangeText(result.amount)})`}`,
              [...new Set(used)],
              income.flags,
            ),
      );
    }
  }
  return lines;
}
