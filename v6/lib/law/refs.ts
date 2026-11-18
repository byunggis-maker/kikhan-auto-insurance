// 라운드 9d: 앱이 인용하는 법령 조문 목록. 코드의 글자에서 "○○법 제N조", "시행령 [별표 N]"을 찾아 모으고(scripts/fetch-laws.ts),
// 약관 질의에 늘 쓰는 기본 조문(BASE_CITATIONS)을 더한다. 외부 호출은 없다(순수 함수, 앱과 스크립트가 함께 쓴다).

export const LAW_NAMES = {
  act: "자동차손해배상 보장법",
  decree: "자동차손해배상 보장법 시행령",
  civil: "민법",
  commercial: "상법",
} as const;
export type LawKey = keyof typeof LAW_NAMES;

export type LawRef = { id: string; law: LawKey; lawName: string; label: string; article: number; branch: number; annex: null } | { id: string; law: LawKey; lawName: string; label: string; article: null; branch: 0; annex: number };

/** 약관 질의(변호사형 답변)에 늘 붙이는 기본 조문: 책임·직접청구·정부보장사업, 공동불법행위·과실상계, 상법 보험편 */
export const BASE_CITATIONS = [
  "자동차손해배상 보장법 제3조",
  "자동차손해배상 보장법 제10조",
  "자동차손해배상 보장법 제30조",
  "자동차손해배상 보장법 시행령 제3조",
  "자동차손해배상 보장법 시행령 [별표 1]",
  "자동차손해배상 보장법 시행령 [별표 2]",
  "민법 제396조",
  "민법 제760조",
  "민법 제763조",
  "상법 제680조",
  "상법 제682조",
  "상법 제724조",
  "상법 제726조의2",
  "상법 제729조",
  "상법 제737조",
];

const NAME = /(자동차손해배상\s*보장법(?:\s*시행령)?|(?<![가-힣])민법|(?<![가-힣])상법)\s*(?:제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|\[?\s*별표\s*(\d+)\s*\]?)/g;
/** "시행령 [별표 1]"처럼 법 이름 없이 시행령만 적은 곳(자배법 시행령으로 본다) */
const DECREE_ANNEX = /(?<![가-힣])시행령\s*\[?\s*별표\s*(\d+)/g;

function keyOf(name: string): LawKey {
  const flat = name.replace(/\s/g, "");
  if (flat.startsWith("자동차손해배상보장법")) return flat.endsWith("시행령") ? "decree" : "act";
  return flat === "민법" ? "civil" : "commercial";
}

export function articleRef(law: LawKey, article: number, branch = 0): LawRef {
  return { id: `${law}-${article}${branch ? `-${branch}` : ""}`, law, lawName: LAW_NAMES[law], label: `제${article}조${branch ? `의${branch}` : ""}`, article, branch, annex: null };
}
export function annexRef(law: LawKey, annex: number): LawRef {
  return { id: `${law}-annex-${annex}`, law, lawName: LAW_NAMES[law], label: `별표${annex}`, article: null, branch: 0, annex };
}

/** 글자에서 법령 조문 인용을 찾는다(같은 조문은 한 번, 나온 순서대로) */
export function refsFromText(text: string): LawRef[] {
  const found = new Map<string, LawRef>();
  const add = (ref: LawRef) => found.has(ref.id) || found.set(ref.id, ref);
  for (const m of text.normalize("NFKC").matchAll(NAME)) {
    const law = keyOf(m[1]);
    if (m[4]) add(annexRef(law, Number(m[4])));
    else if (law !== "act" || !/시행령/.test(m[1])) add(articleRef(law, Number(m[2]), m[3] ? Number(m[3]) : 0));
  }
  for (const m of text.normalize("NFKC").matchAll(DECREE_ANNEX)) add(annexRef("decree", Number(m[1])));
  return [...found.values()];
}

/** 기본 조문 + 코드에서 찾은 조문 */
export function wantedRefs(codeTexts: string[]): LawRef[] {
  const all = new Map<string, LawRef>();
  for (const ref of [...refsFromText(BASE_CITATIONS.join("\n")), ...codeTexts.flatMap(refsFromText)]) if (!all.has(ref.id)) all.set(ref.id, ref);
  return [...all.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** "civil-760", "commercial-726-2", "decree-annex-1" → 조문 */
export function refById(id: string): LawRef | null {
  const m = /^(act|decree|civil|commercial)-(annex-)?(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return null;
  const law = m[1] as LawKey;
  return m[2] ? annexRef(law, Number(m[3])) : articleRef(law, Number(m[3]), m[4] ? Number(m[4]) : 0);
}
