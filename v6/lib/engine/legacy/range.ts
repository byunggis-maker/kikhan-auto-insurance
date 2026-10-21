// 이식 원본: compass/lib/engine/range.ts 1–31행 전체 (compass 커밋 e58ffd1). 보조 함수(won·fromScenarios). 바꾼 것: 없음.
// MASTER.md 6장 이식 로직(부록 A). 아직 v6 엔진에 연결하지 않았다.
import { SCENARIOS, type Range, type Scenario } from "./types";

// 최소·예상·최대 세 값을 다루는 함수.

export const ZERO: Range = { min: 0, expected: 0, max: 0 };

export function same(value: number): Range {
  return { min: value, expected: value, max: value };
}

export function addRanges(ranges: Range[]): Range {
  return ranges.reduce((sum, r) => ({ min: sum.min + r.min, expected: sum.expected + r.expected, max: sum.max + r.max }), ZERO);
}

/** 세 경우를 각각 계산해 Range로 묶는다. 최소 ≤ 예상 ≤ 최대가 되도록 순서를 바로잡는다 */
export function fromScenarios(calculate: (scenario: Scenario) => number): Range {
  const [min, expected, max] = SCENARIOS.map(calculate);
  const low = Math.min(min, expected, max);
  const high = Math.max(min, expected, max);
  return { min: low, expected: Math.min(Math.max(expected, low), high), max: high };
}

/** 금액을 "1,234,000원"으로 적는다 */
export function won(value: number) {
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
}

/** 범위를 글로 적는다. 세 값이 같으면 하나만 적는다 */
export function rangeText(range: Range) {
  return range.min === range.max ? won(range.expected) : `${won(range.min)} ~ ${won(range.max)} (예상 ${won(range.expected)})`;
}
