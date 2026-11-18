import type { ProductLine } from "@/lib/claim/types";

// 라운드 9: 앱에 들어 있는 약관 원문(lib/terms/data.json, scripts/build-terms.mjs가 만든다)에서 질문과 관련된 쪽을 찾는다.
// 서버에서만 쓴다(원문 1.7MB를 화면에 보내지 않는다). 검색은 낱말이 쪽에 몇 번 나오는지와 낱말의 드문 정도로 점수를 매긴다.

export type TermsPage = { p: number; t: string };
export type TermsData = Record<ProductLine, { name: string; pages: TermsPage[] }>;
export type TermsHit = { product: string; page: number; text: string; score: number };

/** 낱말 끝의 조사를 떼어 검색어를 만든다 */
const PARTICLES = /(으로부터|에서는|에게서|으로는|이라도|에서|으로|에게|까지|부터|이나|이며|이고|이란|라도|하는|되는|하면|되면|인가요|나요|은|는|이|가|을|를|에|의|로|도|만|와|과|요)$/;
const STOP = new Set(["얼마", "얼마나", "받을", "있나요", "있는지", "어떻게", "무엇", "경우", "이번", "사고", "보험", "보상", "되나요", "수", "있어요", "제가", "저는", "나는", "내가"]);

export function terms(query: string): string[] {
  const words = query
    .normalize("NFKC")
    .split(/[^0-9A-Za-z가-힣Ⅰ-Ⅻ]+/)
    .map((w) => w.replace(PARTICLES, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words)];
}

const squash = (text: string) => text.replace(/\s+/g, "");

/**
 * 관련 쪽 상위 limit개. extra는 사고 사실에서 온 검색어(예: 담보 이름)로 점수를 반만 준다.
 * 같은 쪽에 여러 검색어가 나올수록, 드문 검색어일수록 점수가 높다.
 */
export function searchTerms(data: TermsData, product: ProductLine | null, query: string, extra: string[] = [], limit = 8): TermsHit[] {
  const book = data[product ?? "personal"];
  const pages = book.pages.map((page) => ({ page, flat: squash(page.t) }));
  const weighted = [...terms(query).map((term) => ({ term, weight: 1 })), ...extra.filter((t) => t.length >= 2).map((term) => ({ term: squash(term), weight: 0.5 }))];
  const df = new Map(weighted.map(({ term }) => [term, pages.filter((x) => x.flat.includes(term)).length]));
  const scored = pages.map(({ page, flat }) => {
    let score = 0;
    let matched = 0;
    for (const { term, weight } of weighted) {
      const count = flat.split(term).length - 1;
      if (!count) continue;
      score += weight * Math.log(1 + count) * Math.log(1 + pages.length / df.get(term)!);
      matched++;
    }
    // 여러 검색어가 함께 나오는 쪽을 앞에
    return { product: book.name, page: page.p, text: page.t, score: score * (1 + matched / Math.max(1, weighted.length)) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, limit);
}
