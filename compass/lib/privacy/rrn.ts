// 주민등록번호 처리. 뒷자리 7자리 전체는 저장·응답·로그 어디에도 넘기지 않는다.
// 생년월일과 성별만 뽑고 뒷자리는 가린다. LLM의 출력도 믿지 않고 여기서 한 번 더 거른다.

const MASK = "******";

// 구분 기호가 있는 꼴. 뒷자리가 이미 일부 가려진 것(800505-1******)도 잡는다. 판독 오류가 있을 수 있어 앞자리 날짜는 따지지 않는다.
const HYPHENATED = /(?<!\d)(\d{6})\s*[-–—‐~]\s*([1-8])[\d*＊xX●○#]{6}(?![\d*＊●○#])/g;
// 붙여 쓰거나 띄어 쓴 꼴. 다른 번호와 헷갈리지 않게 앞자리가 날짜 모양일 때만 잡는다.
const JOINED = /(?<!\d)(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))\s*([1-8])\d{6}(?!\d)/g;

export type ResidentParts = { front6: string; backFirst: string };

/** 글 안의 주민등록번호 뒷자리를 가린다. 앞 6자리(생년월일)만 남는다. */
export function maskResidentNumbers(text: string): string {
  return text.replace(HYPHENATED, `$1-${MASK}`).replace(JOINED, `$1-${MASK}`);
}

/** 글에서 처음 나오는 주민등록번호의 앞 6자리와 뒷자리 첫 숫자. */
export function findResidentNumber(text: string): ResidentParts | null {
  for (const pattern of [HYPHENATED, JOINED]) {
    const match = new RegExp(pattern.source).exec(text);
    if (match) return { front6: match[1], backFirst: match[2] };
  }
  return null;
}

/** 달력에 있는 날짜인지 확인하고 YYYY-MM-DD로 만든다. */
export function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 앞 6자리와 뒷자리 첫 숫자로 생년월일과 성별을 만든다. 맞지 않는 값이면 null. */
export function birthFromResident(front6: string | null, backFirst: string | null): { birthDate: string; gender: "M" | "F" } | null {
  if (!front6 || !backFirst || !/^\d{6}$/.test(front6) || !/^[1-8]$/.test(backFirst)) return null;
  const digit = Number(backFirst);
  // 1·2·5·6은 1900년대, 3·4·7·8은 2000년대 출생이다. 홀수는 남성, 짝수는 여성.
  const century = [1, 2, 5, 6].includes(digit) ? 1900 : 2000;
  const birthDate = isoDate(century + Number(front6.slice(0, 2)), Number(front6.slice(2, 4)), Number(front6.slice(4, 6)));
  return birthDate ? { birthDate, gender: digit % 2 === 1 ? "M" : "F" } : null;
}

/** 객체·배열 안의 모든 문자열에서 주민등록번호 뒷자리를 가린다. */
export function maskDeep<T>(value: T): T {
  if (typeof value === "string") return maskResidentNumbers(value) as T;
  if (Array.isArray(value)) return value.map((item) => maskDeep(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskDeep(item)])) as T;
  }
  return value;
}
