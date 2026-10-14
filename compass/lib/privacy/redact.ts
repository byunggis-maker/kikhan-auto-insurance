// 개인 식별 정보 가리기. 판독 결과·PDF 글자·전사문·사고 설명 글·읽어주기 글이 모두 이 함수를 거친다(CLAUDE.md 설계 원칙 3).
// 가린 자리는 "******"로 바꾸고, 몇 건을 가렸는지만 알린다. 가린 원래 값은 어디에도 남기지 않는다.
// 금액(30,000,000, 3천만원), 날짜, 상해급수, 과실비율, 보험사 대표번호(1588-0000 꼴)는 가리지 않는다(tests/redact.test.ts).
// 항목 이름 없이 문장 속에 섞인 이름·주소는 다 잡지 못한다. 그래서 판독·추출 스키마에 이름·주소 칸을 두지 않는 것이 첫 방어이고, 이 파일은 두 번째 방어다.

export const MASK = "******";

export type RedactKind = "rrn" | "email" | "card" | "phone" | "vehicle" | "account" | "policy" | "name" | "address";

export type Redacted = { text: string; count: number };

const REGIONS = "서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주";
// 자동차 등록번호의 가운데 글자(용도 기호)
const PLATE_LETTERS = "가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호육해공국합";

const NAME_LABELS = "보험계약자|계약자|기명피보험자|피보험자|성명|운전자명|예금주|이름|고객명|가입자";
const ADDRESS_LABELS = "주소|소재지|거주지|주\\s?소";
const POLICY_LABELS = "증권번호|계약번호|증서번호|증권\\s?No\\.?|Policy\\s?No\\.?";
const ACCOUNT_LABELS = "계좌번호|계좌|입금계좌";
// 이름 칸 뒤에 와도 사람 이름이 아닌 말(담보 이름, 운전자 범위 등)
const NOT_A_NAME = /(사고|상해|배상|담보|보험|특약|한정|가족|부부|본인|누구|동일|기준|범위|이상|이하|연령|운전|해당|없음|미가입|가입|정보|확인|자동차|차량|소유|명의)/;

// valueGroup: 항목 이름이 붙은 규칙에서 가릴 값이 든 묶음 번호(항목 이름은 남긴다). 없으면 찾은 글 전체를 가린다.
type Rule = { kind: RedactKind; pattern: RegExp; replace: (match: string, ...groups: string[]) => string | null; valueGroup?: number };

const keepLabel = (label: string, separator: string) => `${label}${separator}${MASK}`;

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

const digitCount = (value: string) => value.replace(/\D/g, "").length;

// 순서가 중요하다. 항목 이름이 붙은 값을 먼저 가리고, 그다음 꼴로 잡는다.
const RULES: Rule[] = [
  // 항목 이름 + 값
  {
    kind: "name",
    pattern: new RegExp(`(${NAME_LABELS})(\\s*(?:명|성명)?\\s*[:：]?\\s*)([가-힣]{2,5})(?![가-힣])`, "g"),
    replace: (match, label, separator, value) => (NOT_A_NAME.test(value) ? null : keepLabel(label, separator)),
    valueGroup: 3,
  },
  { kind: "address", pattern: new RegExp(`(${ADDRESS_LABELS})(\\s*[:：]?\\s*)([^\\n]{4,80})`, "g"), replace: (match, label, separator) => keepLabel(label, separator), valueGroup: 3 },
  { kind: "policy", pattern: new RegExp(`(${POLICY_LABELS})(\\s*[:：]?\\s*)([^\\s,]{4,40})`, "gi"), replace: (match, label, separator) => keepLabel(label, separator), valueGroup: 3 },
  { kind: "account", pattern: new RegExp(`(${ACCOUNT_LABELS})(\\s*[:：]?\\s*)([0-9][0-9 -]{6,24}[0-9])`, "g"), replace: (match, label, separator) => keepLabel(label, separator), valueGroup: 3 },
  // 꼴로 잡는 것
  { kind: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replace: () => MASK },
  // 주민등록번호·외국인등록번호: 앞 6자리 + 뒷자리(일부를 * 등으로 가린 꼴 포함). 앞자리도 생년월일이므로 함께 가린다.
  { kind: "rrn", pattern: /(?<!\d)\d{6}\s*[-–—‐~]\s*[1-8][\d*＊xX●○#]{6}(?![\d*＊●○#])/g, replace: () => MASK },
  { kind: "rrn", pattern: /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s?[1-8]\d{6}(?!\d)/g, replace: () => MASK },
  // 카드번호: 13~19자리(빈칸·하이픈 허용) + Luhn 검사
  { kind: "card", pattern: /(?<![\d,])\d(?:[ -]?\d){12,18}(?![\d,])/g, replace: (match) => (luhn(match.replace(/\D/g, "")) ? MASK : null) },
  // 휴대전화와 지역번호 전화. 15xx·16xx·18xx 대표번호는 남긴다(보험사 콜센터).
  { kind: "phone", pattern: /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g, replace: () => MASK },
  { kind: "phone", pattern: /(?<![\d-])0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70)[-.)\s]\s?\d{3,4}[-.\s]\d{4}(?!\d)/g, replace: () => MASK },
  // 차량번호: (지역)12가3456, 123가4567
  { kind: "vehicle", pattern: new RegExp(`(?:(?:${REGIONS})\\s?)?(?<!\\d)\\d{2,3}\\s?[${PLATE_LETTERS}]\\s?\\d{4}(?!\\d)`, "g"), replace: () => MASK },
  // 계좌번호 꼴: 하이픈으로 나뉜 숫자 묶음 3~4개, 숫자 10~14자리. 날짜(2026-09-01)는 숫자 8자리라 걸리지 않는다.
  { kind: "account", pattern: /(?<![\d,-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,3})?(?![\d,-])/g, replace: (match) => (digitCount(match) >= 10 && digitCount(match) <= 14 ? MASK : null) },
  // 증권번호처럼 보이는 긴 묶음: 영문·숫자·하이픈 10자 이상이면서 숫자 8개 이상(쉼표 금액·날짜 제외), 또는 숫자만 12자리 이상
  {
    kind: "policy",
    pattern: /(?<![\w,.-])[A-Za-z0-9][A-Za-z0-9-]{9,39}(?![\w,.-])/g,
    replace: (match) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(match)) return null;
      const digits = digitCount(match);
      const mixed = /[A-Za-z-]/.test(match);
      return (mixed && digits >= 8) || (!mixed && digits >= 12) ? MASK : null;
    },
  },
];

/** 글 안의 개인 식별 정보를 가린다. */
export function redact(text: string): Redacted {
  let count = 0;
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.filter((item): item is string => typeof item === "string");
      const replaced = rule.replace(match, ...groups);
      if (replaced === null) return match;
      count += 1;
      return replaced;
    });
  }
  return { text: out, count };
}

export type SensitiveSpan = { kind: RedactKind; start: number; end: number };

/**
 * 가릴 자리를 글자 위치로 돌려준다(글은 바꾸지 않는다). 사진의 글자 인식 결과에서 칠할 곳을 정할 때 쓴다(lib/privacy/image-mask.ts).
 * redact와 같은 규칙을 같은 순서로 쓰고, 앞 규칙이 잡은 자리와 겹치는 것은 건너뛴다.
 */
export function findSensitive(text: string): SensitiveSpan[] {
  const spans: SensitiveSpan[] = [];
  const overlaps = (start: number, end: number) => spans.some((span) => start < span.end && span.start < end);
  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags}d`);
    for (const match of text.matchAll(pattern)) {
      const groups = match.slice(1).filter((item): item is string => typeof item === "string");
      if (rule.replace(match[0], ...groups) === null) continue;
      const [start, end] = rule.valueGroup ? match.indices![rule.valueGroup]! : match.indices![0]!;
      if (start === end || overlaps(start, end)) continue;
      spans.push({ kind: rule.kind, start, end });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** 객체·배열 안의 모든 문자열을 가린다. 칸 이름(키)은 바꾸지 않는다. */
export function redactDeep<T>(value: T): { value: T; count: number } {
  let count = 0;
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") {
      const result = redact(item);
      count += result.count;
      return result.text;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    return item;
  };
  return { value: walk(value) as T, count };
}
