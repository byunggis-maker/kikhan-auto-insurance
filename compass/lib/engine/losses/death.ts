import type { PersonClaim } from "@/lib/schemas/person-claim";
import { birthRangeFromAge, overBirths } from "../age";
import { ageOn } from "../dates";
import { rangeText, won } from "../range";
import { scale, type Rules } from "../rules";
import type { LossLine } from "../types";
import { hoffmanCoefficient, monthlyIncomeBasis } from "./earnings";
import { calculated, missing, needsCheck } from "./line";

// 사망 손해 항목: 장례비, 위자료, 상실수익액. 대인배상 지급기준 "가. 사망".
// 나이는 사고일의 만 나이로 받는다. 생일을 모르므로 나이가 들어가는 항목은 생일 1년 폭의 양 끝으로 최소·최대를 낸다(lib/engine/age.ts).

export const AGE_MISSING = { field: "age", message: "만 나이를 입력하면 계산됩니다" };
export const ageNote = (age: number) => `사고일 만 ${age}세(생일을 몰라 1년 폭으로 계산)`;

export function deathLosses(person: PersonClaim, accidentDate: string, rules: Rules): LossLine[] {
  const death = person.death;
  if (death === null) return [];
  const lines: LossLine[] = [];

  const funeral = { item: "funeral", category: "death" as const, label: "장례비", required: true };
  {
    const used: string[] = [];
    const amount = rules.number("funeral.amount", used);
    lines.push(amount === null ? needsCheck(funeral, "장례비 기준을 확인하지 못했습니다", used) : calculated(funeral, amount, `장례비 ${won(amount)}`, used));
  }

  const solatium = { item: "solatium_death", category: "death" as const, label: "위자료(사망)", required: true };
  const earnings = { item: "lost_earnings_death", category: "death" as const, label: "상실수익액(사망)" };
  if (person.age === null) {
    lines.push(missing(solatium, [AGE_MISSING]), missing(earnings, [AGE_MISSING]));
    return lines;
  }
  const births = birthRangeFromAge(person.age, accidentDate);

  {
    const used: string[] = [];
    const threshold = rules.number("solatium.ageThreshold", used);
    const result = overBirths<{ amount: number; age: number }>(births, (birth) => {
      const age = ageOn(birth, death.date);
      const amount = threshold === null ? null : rules.number(age < threshold ? "solatium.death.under" : "solatium.death.over", used);
      return amount === null || threshold === null ? { ok: false, text: "사망 위자료 기준을 확인하지 못했습니다" } : { ok: true, amount, age };
    });
    if (!result.ok) lines.push(needsCheck(solatium, result.text, [...new Set(used)]));
    else {
      const { age } = result.expected;
      const how = result.amount.min === result.amount.max ? `사망 당시 ${age}세(${threshold}세 ${age < threshold! ? "미만" : "이상"}) → ${won(result.amount.expected)}` : `사망 당시 나이가 ${threshold}세 앞뒤라 ${rangeText(result.amount)}`;
      lines.push(calculated(solatium, result.amount, `${ageNote(person.age)}: ${how}`, [...new Set(used)]));
    }
  }

  {
    const used: string[] = [];
    const income = monthlyIncomeBasis(person, rules, used);
    const living = rules.record("lostEarnings.livingCostRatio", used);
    if (!income.ok) lines.push(needsCheck(earnings, income.text, [...new Set(used)], income.flags));
    else if (living === null) lines.push(needsCheck(earnings, "생활비율을 확인하지 못했습니다", [...new Set(used)]));
    else {
      const { numerator, denominator } = living;
      const result = overBirths<{ amount: number; coefficient: string }>(births, (birth) => {
        const coefficient = hoffmanCoefficient(birth, death.date, rules, used);
        if (!coefficient.ok) return coefficient;
        const amount = scale(rules, used, income.value, [[denominator - numerator, denominator], [coefficient.value, 1]]);
        return amount === null ? { ok: false, text: "원 미만 처리 방식을 확인하지 못했습니다" } : { ok: true, amount, coefficient: coefficient.text };
      });
      lines.push(
        !result.ok
          ? needsCheck(earnings, result.text, [...new Set(used)])
          : calculated(
              earnings,
              result.amount,
              `${ageNote(person.age)}. 예상: ${income.text} × (1 − 생활비율 ${numerator}/${denominator}) × ${result.expected.coefficient} = ${won(result.amount.expected)}${result.amount.min === result.amount.max ? "" : ` (생일에 따라 ${rangeText(result.amount)})`}`,
              [...new Set(used)],
              income.flags,
            ),
      );
    }
  }
  return lines;
}
