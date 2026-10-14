import { addYears } from "./dates";
import type { Range } from "./types";

// 생년월일 대신 만 나이를 받는다(개인정보를 줄이기 위해, docs/PLAN.md 7절).
// 사고일에 만 N세인 사람은 생일이 1년 폭 안 어딘가에 있다. 나이가 들어가는 계산(위자료 나이 기준, 취업가능월수)은
// 그 폭의 양 끝으로 각각 계산해 최소·최대로 내고, 예상은 폭의 가운데(생일이 반년 전)로 계산한다.

const pad = (value: number, size = 2) => String(value).padStart(size, "0");
const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysInMonth = (year: number, month: number) => (month === 2 && isLeap(year) ? 29 : DAYS[month - 1]);

/** "YYYY-MM-DD"의 다음 날. 날짜 계산은 달력 규칙으로만 한다(시계를 읽지 않는다). */
export function nextDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  if (d < daysInMonth(y, m)) return `${pad(y, 4)}-${pad(m)}-${pad(d + 1)}`;
  return m === 12 ? `${pad(y + 1, 4)}-01-01` : `${pad(y, 4)}-${pad(m + 1)}-01`;
}

/** "YYYY-MM-DD"에 months개월을 더한다. 그 달에 없는 날은 그 달 마지막 날로 본다. */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/** 사고일에 만 age세인 사람이 태어났을 수 있는 날: 가장 이른 날, 가운데, 가장 늦은 날 */
export type BirthRange = { earliest: string; expected: string; latest: string };

export function birthRangeFromAge(age: number, onDate: string): BirthRange {
  const latest = addYears(onDate, -age);
  return { earliest: nextDay(addYears(onDate, -(age + 1))), expected: addMonths(latest, -6), latest };
}

/**
 * 생일 세 경우로 각각 계산해 범위로 묶는다. 하나라도 계산하지 못하면 그 이유를 돌려준다.
 * 예상은 가운데 생일의 값, 최소·최대는 세 값 가운데 가장 작은·큰 값이다.
 */
export function overBirths<T extends { amount: number }>(
  births: BirthRange,
  calculate: (birthDate: string) => ({ ok: true } & T) | { ok: false; text: string },
): { ok: true; amount: Range; expected: T } | { ok: false; text: string } {
  const results = [calculate(births.earliest), calculate(births.expected), calculate(births.latest)];
  for (const result of results) if (!result.ok) return result;
  const values = results.map((result) => (result as { ok: true } & T).amount);
  const expected = results[1] as { ok: true } & T;
  return { ok: true, amount: { min: Math.min(...values), expected: expected.amount, max: Math.max(...values) }, expected };
}
