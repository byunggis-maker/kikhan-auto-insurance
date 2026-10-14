import type { AccidentKind } from "@/lib/draft/types";
import type { CoverageKey } from "@/lib/engine/types";

// 화면에서 볼 수 있는 법령 조문과 판례 검색어의 목록. 서버는 이 목록에 있는 것만 국가법령정보센터에 묻는다.
// (아무 검색어나 받아 주면 우리 인증값으로 남이 마음대로 조회할 수 있다.)

/** 국가법령정보센터의 법령 ID */
const LAWS = {
  act: { id: "001746", name: "자동차손해배상 보장법" },
  decree: { id: "004594", name: "자동차손해배상 보장법 시행령" },
} as const;

export type LawRef = "act-3" | "act-5" | "act-10" | "act-30" | "decree-3";

/** article: 조 번호. why: 이 조문을 왜 보여 주는지 */
export const LAW_ARTICLES: Record<LawRef, { law: keyof typeof LAWS; article: number; why: string }> = {
  "act-3": { law: "act", article: 3, why: "자동차 사고의 손해배상책임" },
  "act-5": { law: "act", article: 5, why: "책임보험(대인배상Ⅰ)과 대물배상 가입 의무" },
  "act-10": { law: "act", article: 10, why: "피해자가 보험회사에 직접 청구할 수 있는 권리" },
  "act-30": { law: "act", article: 30, why: "무보험·뺑소니 사고의 정부보장사업" },
  "decree-3": { law: "decree", article: 3, why: "책임보험금 한도(사망·부상·후유장애, 대물)" },
};

export function isLawRef(value: string): value is LawRef {
  return Object.hasOwn(LAW_ARTICLES, value);
}

export function lawOf(ref: LawRef) {
  const { law, article, why } = LAW_ARTICLES[ref];
  return { ...LAWS[law], article, why, label: `${LAWS[law].name} 제${article}조` };
}

/** 담보별로 "법령 보기"에 띄울 조문 */
export const COVERAGE_LAWS: Partial<Record<CoverageKey, LawRef[]>> = {
  liability_bodily_1: ["decree-3", "act-3", "act-5", "act-10"],
  liability_bodily_2: ["act-3", "act-10"],
  liability_property: ["act-5", "decree-3"],
  uninsured: ["act-30"],
};

/** 판례 검색에 쓸 수 있는 검색어. 과실비율이 다툼이 될 때 참고할 판례를 찾는다 */
export const PRECEDENT_KEYWORDS = [
  "교통사고 과실비율",
  "교차로 과실비율",
  "추돌사고 과실",
  "차로변경 과실",
  "신호위반 과실비율",
  "주차장 사고 과실",
  "보행자 과실상계",
  "횡단보도 과실",
  "무단횡단 과실",
  "이륜자동차 과실비율",
  "안전띠 과실상계",
  "호의동승 감액",
] as const;

export type PrecedentKeyword = (typeof PRECEDENT_KEYWORDS)[number];

export function isPrecedentKeyword(value: string): value is PrecedentKeyword {
  return (PRECEDENT_KEYWORDS as readonly string[]).includes(value);
}

const BY_KIND: Record<AccidentKind, PrecedentKeyword[]> = {
  car_car: ["교차로 과실비율", "추돌사고 과실", "차로변경 과실", "신호위반 과실비율", "주차장 사고 과실"],
  car_person: ["보행자 과실상계", "횡단보도 과실", "무단횡단 과실"],
  motorcycle: ["이륜자동차 과실비율", "교차로 과실비율", "차로변경 과실"],
  single: [],
};

/** 사고 유형에 맞는 검색어를 앞에 둔다 */
export function keywordsFor(kind: AccidentKind | ""): PrecedentKeyword[] {
  const first = kind ? BY_KIND[kind] : [];
  return [...new Set<PrecedentKeyword>([...first, "교통사고 과실비율", "안전띠 과실상계", "호의동승 감액"])];
}
