import type { PersonClaim } from "@/lib/schemas/person-claim";
import { ageOn } from "../dates";
import { won } from "../range";
import { scale, type Rules } from "../rules";
import type { LossLine } from "../types";
import { hoffmanCoefficient, monthlyIncomeBasis } from "./earnings";
import { calculated, missing, needsCheck } from "./line";

// 사망 손해 항목: 장례비, 위자료, 상실수익액. 대인배상 지급기준 "가. 사망".

export function deathLosses(person: PersonClaim, rules: Rules): LossLine[] {
  const death = person.death;
  if (death === null) return [];
  const lines: LossLine[] = [];
  const birthMissing = [{ field: "birthDate", message: "생년월일을 입력하면 계산됩니다" }];

  const funeral = { item: "funeral", category: "death" as const, label: "장례비", required: true };
  {
    const used: string[] = [];
    const amount = rules.number("funeral.amount", used);
    lines.push(amount === null ? needsCheck(funeral, "장례비 기준을 확인하지 못했습니다", used) : calculated(funeral, amount, `장례비 ${won(amount)}`, used));
  }

  const solatium = { item: "solatium_death", category: "death" as const, label: "위자료(사망)", required: true };
  if (person.birthDate === null) lines.push(missing(solatium, birthMissing));
  else {
    const used: string[] = [];
    const threshold = rules.number("solatium.ageThreshold", used);
    const age = ageOn(person.birthDate, death.date);
    const amount = threshold === null ? null : rules.number(age < threshold ? "solatium.death.under" : "solatium.death.over", used);
    lines.push(
      threshold === null || amount === null
        ? needsCheck(solatium, "사망 위자료 기준을 확인하지 못했습니다", used)
        : calculated(solatium, amount, `사망 당시 ${age}세(${threshold}세 ${age < threshold ? "미만" : "이상"}) → ${won(amount)}`, used),
    );
  }

  const earnings = { item: "lost_earnings_death", category: "death" as const, label: "상실수익액(사망)" };
  if (person.birthDate === null) lines.push(missing(earnings, birthMissing));
  else {
    const used: string[] = [];
    const income = monthlyIncomeBasis(person, rules, used);
    const coefficient = hoffmanCoefficient(person.birthDate, death.date, rules, used);
    const living = rules.record("lostEarnings.livingCostRatio", used);
    if (!income.ok) lines.push(needsCheck(earnings, income.text, used, income.flags));
    else if (!coefficient.ok) lines.push(needsCheck(earnings, coefficient.text, used));
    else if (living === null) lines.push(needsCheck(earnings, "생활비율을 확인하지 못했습니다", used));
    else {
      const { numerator, denominator } = living;
      const amount = scale(rules, used, income.value, [[denominator - numerator, denominator], [coefficient.value, 1]]);
      lines.push(
        amount === null
          ? needsCheck(earnings, "원 미만 처리 방식을 확인하지 못했습니다", used)
          : calculated(earnings, amount, `${income.text} × (1 − 생활비율 ${numerator}/${denominator}) × ${coefficient.text} = ${won(amount)}`, used, income.flags),
      );
    }
  }
  return lines;
}
