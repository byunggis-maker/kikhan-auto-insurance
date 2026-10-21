import type { ProductLine } from "./types";

// 약관 판 목록(결정 기록 D-21). 엔진은 사고일에 시행 중인 판을 골라 계산한다.
// 새 판을 쓰려면: 칸이 PDF를 data/raw/policies/<개정일>/에 넣고 → 개발이 그 판의 숫자를 standards.ts에 판별로 옮긴 뒤 → 여기에 한 줄을 더한다.
// 같은 판으로 확인된 파일만 등록한다(sha256으로 대조, tests/claim/editions.test.ts).

export type Edition = {
  /** 개정일(표지). 시행일이 따로 적혀 있지 않으면 개정일을 시행일로 본다 */
  id: string;
  effectiveFrom: string;
  /** data/raw/policies/ 기준 경로와 sha256 */
  files: Record<ProductLine, { path: string; sha256: string }>;
  /** 판을 확인한 근거 */
  basis: string;
};

export const EDITIONS: Edition[] = [
  {
    id: "2026-10-25",
    effectiveFrom: "2026-10-25",
    files: {
      personal: { path: "개인용 약관.pdf", sha256: "67dc9455b0760dfbb8f0988ad975d33c81a9630888bf83bad99291fc0f3e5262" },
      business: { path: "업무용 약관.pdf", sha256: "cbb1da8d75571c2ac557ff6004606296d098b51825121519d46e8028d6124779" },
      commercial: { path: "영업용 약관.pdf", sha256: "f313c52089022a2475af87f09db10fb0fd45faa2038a082948b983b5904f783d" },
      motorcycle: { path: "이륜차 약관.pdf", sha256: "4b40b1fc303416683d35fca9829efb5a5fe1f610464fceaa04e2718400515aa0" },
    },
    basis: "네 PDF 표지 \"개정 2026.10.25\"(본문·메타데이터에는 날짜 없음)",
  },
];

/** 이 앱의 금액 기준(standards.ts)을 읽은 판 */
export const STANDARDS_EDITION = "2026-10-25";

/** 사고일에 시행 중인 판. 등록된 판이 없으면 null */
export function editionFor(date: string): Edition | null {
  const candidates = EDITIONS.filter((edition) => edition.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates[0] ?? null;
}

export function latestEdition(): Edition {
  return [...EDITIONS].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}
