import type { PersonClaim } from "@/lib/schemas/person-claim";
import { addYears, ageOn, fullMonthsBetween } from "../dates";
import { lessThan } from "../decimal";
import { won } from "../range";
import type { Rules } from "../rules";
import { NOTICES, type Notice } from "../types";

// 사망·후유장애 상실수익액에 함께 쓰는 계산: 월평균 현실소득액, 취업가능월수, 호프만 계수.

/** flags: 이 금액(또는 계산하지 못한 이유)에 붙는 표시 */
export type Basis = { ok: true; value: number; text: string; flags: Notice[] } | { ok: false; text: string; flags: Notice[] };
export type Coefficient = { ok: true; value: string; months: number; text: string } | { ok: false; text: string };

/** 월평균 현실소득액. 증명한 소득이 없으면 일용근로자 임금(월 환산)으로 본다 */
export function monthlyIncomeBasis(person: PersonClaim, rules: Rules, used: string[]): Basis {
  const wage = rules.number("dailyWage.amount", used);
  const monthDays = rules.number("dailyWage.daysPerMonth", used);
  const wageMonthly = wage !== null && monthDays !== null ? wage * monthDays : null;
  if (person.incomeProven === true && person.monthlyIncome !== null) {
    // 증명한 소득이 일용근로자 임금에 못 미치면 일용근로자 임금을 인정한다. 임금을 모르면 입력한 소득으로 계산하고 표시를 남긴다.
    if (wageMonthly !== null && wageMonthly > person.monthlyIncome) return { ok: true, value: wageMonthly, text: `일용근로자 임금 월 ${won(wageMonthly)}(증명한 소득보다 많음)`, flags: [] };
    if (wage === null) return { ok: true, value: person.monthlyIncome, text: `월평균 현실소득액 ${won(person.monthlyIncome)}(${NOTICES.daily_wage_required}: 임금보다 적은 소득인지 비교하지 못함)`, flags: ["daily_wage_required"] };
    return { ok: true, value: person.monthlyIncome, text: `월평균 현실소득액 ${won(person.monthlyIncome)}`, flags: [] };
  }
  if (wage === null) return { ok: false, text: `${NOTICES.daily_wage_required}: 증명한 소득이 없으면 일용근로자 임금으로 계산합니다. 임금이 입력되면 더해집니다`, flags: ["daily_wage_required"] };
  if (wageMonthly === null) return { ok: false, text: "일용근로자 임금을 월 임금으로 바꾸는 기준을 확인하지 못했습니다", flags: [] };
  return { ok: true, value: wageMonthly, text: `일용근로자 임금 ${won(wage)} × ${monthDays}일 = 월 ${won(wageMonthly)}`, flags: [] };
}

/** 기준일(사망일 또는 노동능력상실일)부터 취업가능연한까지의 월수에 해당하는 호프만 계수 */
export function hoffmanCoefficient(birthDate: string, from: string, rules: Rules, used: string[]): Coefficient {
  const retirementAge = rules.number("lostEarnings.retirementAge", used);
  const startAge = rules.number("lostEarnings.workStartAge", used);
  const elder = rules.list<{ fromAge: number; toAge: number | null; months: number }>("lostEarnings.elderMonths", used);
  const table = rules.list<string>("hoffman.table", used);
  const cap = rules.number("lostEarnings.hoffmanCap", used);
  if (retirementAge === null || startAge === null || elder === null || table === null || cap === null) return { ok: false, text: "취업가능월수 또는 호프만 계수 기준을 확인하지 못했습니다" };

  const age = ageOn(birthDate, from);
  if (age < startAge) return { ok: false, text: `${startAge}세 미만 피해자의 상실수익액은 아직 계산하지 않습니다` };
  const band = elder.find((row) => age >= row.fromAge && (row.toAge === null || age < row.toAge));
  const months = band ? band.months : fullMonthsBetween(from, addYears(birthDate, retirementAge));
  const how = band ? `${age}세 피해자의 취업가능월수 ${months}개월` : `${retirementAge}세까지 ${months}개월`;
  if (months === 0) return { ok: true, value: "0", months, text: `${how} → 계수 0` };
  // 표에 없는 긴 기간은 한도 값이다. 표의 값도 한도를 넘지 않게 한다.
  const listed = months <= table.length ? table[months - 1] : String(cap);
  const value = lessThan(listed, cap) ? listed : String(cap);
  return { ok: true, value, months, text: `${how}의 호프만 계수 ${value}` };
}
