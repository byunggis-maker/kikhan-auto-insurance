import type { ProductLine, RuleItem } from "./legacy/schemas/rules";

// 이식 규칙(legacy/data/fault.json)은 원본 그대로 productLines ["personal"]로 둔다.
// v6가 다른 보험 종류의 약관 PDF(data/raw/policies/)와 대조해 같다고 확인한 규칙만 여기서 그 종류를 더한다.
// 다르거나 찾지 못한 규칙은 더하지 않으므로 legacy/verification.ts가 '미검증' 표시를 붙인다.

export type ProductCheck = { productLine: ProductLine; appendix: string; pdfPage: number; printedPage: number };

/**
 * 대조 방법: 별표4 「1. 과실상계 가. 과실상계의 방법」 (1)~(3)과 (*1) 차량운전자 정의를 유니코드 정규화(NFKC)하고
 * 공백·줄바꿈을 지워 글자 단위로 비교했다. 네 약관 모두 625자가 같다(MASTER.md 3부, 결정 기록 D-2).
 * (2)는 치료관계비 하한(대인배상Ⅰ), (3)은 치료관계비 하한(대인배상Ⅱ·무보험)과 경상 12~14급 차량운전자 본인 과실분 치료비 단서다.
 */
const ANNEX4_SAME: ProductCheck[] = [
  { productLine: "business", appendix: "〈별표 4〉 과실상계 등", pdfPage: 45, printedPage: 43 },
  { productLine: "commercial", appendix: "〈별표 4〉 과실상계 등", pdfPage: 45, printedPage: 43 },
  { productLine: "motorcycle", appendix: "〈별표 4〉 과실상계 등", pdfPage: 45, printedPage: 43 },
];

export const VERIFIED_PRODUCT_CHECKS: Record<string, ProductCheck[]> = {
  "fault.medicalFloor": ANNEX4_SAME,
  "fault.minorInjuryGrades": ANNEX4_SAME,
};

/** 대조로 확인한 보험 종류를 productLines에 더한 규칙 목록. 원래 목록은 바꾸지 않는다 */
export function withVerifiedProductLines(items: RuleItem[]): RuleItem[] {
  return items.map((item) => {
    const checks = VERIFIED_PRODUCT_CHECKS[item.id];
    if (!checks) return item;
    const productLines = [...new Set([...item.productLines, ...checks.map((check) => check.productLine)])];
    return { ...item, productLines };
  });
}
