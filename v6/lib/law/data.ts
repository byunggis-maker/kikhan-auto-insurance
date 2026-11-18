import index from "@/data/laws/index.json";
import { refsFromText, type LawRef } from "./refs";

// 라운드 9d: 앱에 들어 있는 법령 원문(data/laws/index.json, 칸 PC에서 npm run laws:fetch로 받는다). 앱은 법령 API를 부르지 않는다.
// 원문이 없거나 받은 지 180일이 넘으면 "원문 갱신 필요"(계산은 막지 않는다).

export const STALE_DAYS = 180;
export const NEEDS_UPDATE = "원문 갱신 필요";

export type LawRecord = { id: string; lawName: string; label: string; heading: string; text: string; effectiveDate: string | null; fetchedAt: string; url: string };
export type LawIndex = { generatedAt: string | null; wanted: string[]; articles: LawRecord[] };

export const LAW_INDEX = index as LawIndex;

/** 받은 날로부터 180일이 넘었는지(today: YYYY-MM-DD) */
export function isStale(fetchedAt: string, today: string): boolean {
  return (Date.parse(today) - Date.parse(fetchedAt.slice(0, 10))) / 86_400_000 > STALE_DAYS;
}

/** "원문 기준일: 2026-11-19 (시행일 2026-01-01)" */
export const asOfText = (r: LawRecord) => `원문 기준일: ${r.fetchedAt.slice(0, 10)} (시행일 ${r.effectiveDate ?? "확인 안 됨"})`;

export type LawView = { ref: LawRef; record: LawRecord | null; stale: boolean };

/** 글자(검토서 근거 등)에 나온 법령 조문과 앱에 든 원문. 원문이 없거나 오래됐으면 stale = true */
export function lawsInText(text: string, today: string, data: LawIndex = LAW_INDEX): LawView[] {
  return refsFromText(text).map((ref) => {
    const record = data.articles.find((a) => a.id === ref.id) ?? null;
    return { ref, record, stale: !record || isStale(record.fetchedAt, today) };
  });
}

export const todaySeoul = (now = new Date()) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
