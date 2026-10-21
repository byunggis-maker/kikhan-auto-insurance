// 이식 원본: compass/lib/engine/decimal.ts 1–48행 전체 (compass 커밋 e58ffd1). 보조 함수(multiply). 바꾼 것: 없음.
// MASTER.md 6장 이식 로직(부록 A). 아직 v6 엔진에 연결하지 않았다.
import Decimal from "decimal.js";

// 비율 계산을 하는 유일한 곳. number의 소수 연산을 쓰지 않고, 마지막에 한 번만 정수(원)로 만든다.

const Exact = Decimal.clone({ precision: 60 });

export type Rounding = "floor" | "round" | "ceil";
export type Factor = [numerator: string | number, denominator: string | number];
/** won: 원 단위 정수, exact: 원 미만이 생기지 않았는지 */
export type Rounded = { won: number; exact: boolean };

const MODES: Record<Rounding, Decimal.Rounding> = { floor: Decimal.ROUND_FLOOR, round: Decimal.ROUND_HALF_UP, ceil: Decimal.ROUND_CEIL };

/**
 * amount에 분수들을 차례로 곱한 값을 원 단위 정수로 만든다.
 * 원 미만이 생겼는데 처리 방식(rounding)이 없으면 null을 돌려준다.
 */
export function multiply(amount: number, factors: Factor[], rounding: Rounding | null): Rounded | null {
  let value = new Exact(amount);
  for (const [numerator, denominator] of factors) value = value.times(numerator).div(denominator);
  if (value.isInteger()) return { won: value.toNumber(), exact: true };
  if (rounding === null) return null;
  return { won: value.toDecimalPlaces(0, MODES[rounding]).toNumber(), exact: false };
}

/** a ≥ b 인지. 소수가 섞인 비율(노동능력상실률 등)을 비교할 때 쓴다 */
export function atLeast(a: string | number, b: string | number) {
  return new Exact(a).gte(b);
}

export function lessThan(a: string | number, b: string | number) {
  return new Exact(a).lt(b);
}

export function isPositive(a: string | number) {
  return new Exact(a).gt(0);
}

/** amount가 base의 percent%를 넘는지 */
export function exceedsPercent(amount: number, base: number, percent: number) {
  return new Exact(amount).times(100).gt(new Exact(base).times(percent));
}

/** "1.5" × 10^power 를 원 단위 정수로. 정수가 되지 않거나 안전 범위를 넘으면 null */
export function timesPowerOfTen(value: string, power: number): number | null {
  const result = new Exact(value).times(new Exact(10).pow(power));
  return result.isInteger() && result.lte(Number.MAX_SAFE_INTEGER) ? result.toNumber() : null;
}
