import type { Deductible } from "@/lib/schemas/vehicle-claim";
import { timesPowerOfTen } from "./decimal";

// 증권에 적힌 금액 표현을 원 단위 정수로 바꾸는 유일한 곳. LLM은 이 변환을 하지 않는다.
// 뜻이 하나로 정해지지 않으면 null을 돌려준다(짐작하지 않는다). "무한"은 숫자가 아니므로 따로 돌려준다.

export type Money = number | "unlimited";

/** 단위 낱말 → 10의 몇 제곱인지 */
const UNITS: Record<string, number> = { 억: 8, 천만: 7, 백만: 6, 십만: 5, 만: 4 };
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const SMALL_UNIT = "천만|백만|십만|만";
/** 금액 하나: "30,000,000원", "3천만원", "1억 5천만원", "무한" */
const AMOUNT = String.raw`(?:무한|무제한|${NUMBER}\s*억(?:\s*${NUMBER}\s*(?:${SMALL_UNIT}))?\s*원?|${NUMBER}\s*(?:${SMALL_UNIT})\s*원?|${NUMBER}\s*원|\d[\d,]{3,})`;

/**
 * 금액 표현 하나를 원 단위 정수로 바꾼다.
 * "3천만원" → 30,000,000 / "1억 5천만원" → 150,000,000 / "30,000,000" → 30,000,000 / "무한" → "unlimited"
 * 금액이 둘 이상이거나("3천만원 또는 5천만원"), 단위가 모호하거나("3천원"), 비율이면 null.
 */
export function parseMoney(raw: string | number | null | undefined): Money | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  const text = (raw ?? "").replace(/[\s,]/g, "").replace(/^(?:가입금액|가입한도|보상한도|보험가입금액)[:：]?/, "");
  if (text === "무한" || text === "무제한") return "unlimited";
  const plain = /^(\d+)원?$/.exec(text);
  if (plain) return timesPowerOfTen(plain[1], 0);
  const match = new RegExp(String.raw`^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)(${SMALL_UNIT}))?원?$`).exec(text);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  const high = match[1] === undefined ? 0 : timesPowerOfTen(match[1], UNITS.억);
  const low = match[2] === undefined ? 0 : timesPowerOfTen(match[2], UNITS[match[3]]);
  if (high === null || low === null) return null;
  // "1억 5천만원"에서 뒤쪽이 앞 단위보다 크면 잘못 읽은 것이다.
  if (match[1] !== undefined && match[2] !== undefined && low >= (timesPowerOfTen("1", UNITS.억) as number)) return null;
  return Number.isSafeInteger(high + low) ? high + low : null;
}

/** 글 안에 있는 금액 표현을 모두 찾아 바꾼다. 바꾸지 못한 표현은 뺀다 */
function amountsIn(text: string): Money[] {
  return [...text.matchAll(new RegExp(AMOUNT, "g"))].map((match) => parseMoney(match[0])).filter((value): value is Money => value !== null);
}

/**
 * "사고당 10억원 한도", "1인당 무한"처럼 금액이 하나만 들어 있는 글에서 그 금액을 꺼낸다.
 * 서로 다른 금액이 둘 이상이면 null.
 */
export function singleMoney(text: string | null | undefined): Money | null {
  const whole = parseMoney(text);
  if (whole !== null) return whole;
  const found = [...new Set(amountsIn(text ?? ""))];
  return found.length === 1 ? found[0] : null;
}

/**
 * "사망/후유장애 3억원, 부상 3천만원"에서 이름표(예: "부상") 바로 뒤의 금액을 꺼낸다.
 * 이름표 뒤에 서로 다른 금액이 여럿이면 null. 숫자만 떼어 읽지 않는다("부상 3천만원"을 3으로 읽지 않는다).
 */
export function moneyAfterLabel(text: string | null | undefined, labels: string[]): Money | null {
  const source = text ?? "";
  const found = new Set<Money>();
  for (const label of labels) {
    const pattern = new RegExp(String.raw`${label}[^\d,;]{0,12}?(${AMOUNT})`, "g");
    for (const match of source.matchAll(pattern)) {
      const value = parseMoney(match[1]);
      if (value === null) return null;
      found.add(value);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * 증권의 자기부담금 표현을 조건으로 바꾼다.
 * "50만원" → 정액 / "손해액의 20%(최저 20만원, 최고 50만원)" → 비율·최소·최대. 그 밖에는 null.
 */
export function parseDeductible(text: string | null | undefined): Deductible | null {
  const raw = (text ?? "").trim();
  const fixed = parseMoney(raw);
  if (typeof fixed === "number") return { type: "fixed", amount: fixed };
  const rates = [...raw.matchAll(/(\d{1,3})\s*%/g)].map((match) => Number(match[1]));
  const bound = (labels: string) => {
    const value = moneyAfterLabel(raw, labels.split("|"));
    return typeof value === "number" ? value : null;
  };
  const min = bound("최소|최저");
  const max = bound("최대|최고");
  if (rates.length !== 1 || rates[0] < 1 || rates[0] > 100 || min === null || max === null || min > max) return null;
  return { type: "rate", ratePercent: rates[0], min, max };
}
