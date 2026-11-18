// 라운드 9d: 국가법령정보센터 Open API 응답을 글자로 펴는 순수 함수. 앱은 법령 API를 부르지 않는다.
// 원문은 칸 PC(open.law.go.kr에 IP 등록)에서 scripts/fetch-laws.ts가 받아 data/laws/에 저장하고, 앱은 그 파일만 읽는다(lib/law/data.ts).

/** open.law.go.kr에 등록한 도메인(이 앱의 배포 주소). 스크립트가 Referer로 싣는다 */
export const SITE = "https://kikhan-auto-compass-v6.vercel.app";
export const LAW_API_BASE = "https://www.law.go.kr/DRF";

export type ParsedLaw = { lawName: string; heading: string; text: string; url: string; effectiveDate: string | null };

/** 별표 한 개의 글자 수 상한(약관 질의 프롬프트가 너무 길어지지 않게) */
const MAX_TEXT = 6000;

const record = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const list = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(record).filter((x): x is Record<string, unknown> => x !== null);
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").trim() : Array.isArray(v) ? v.flat(Infinity).filter((x) => typeof x === "string").join("\n").replace(/[ \t]+/g, " ").trim() : "");
const dateOf = (v: unknown) => {
  const m = /^(\d{4})\.?(\d{2})\.?(\d{2})$/.exec(text(v));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
export const lawUrl = (name: string, label: string) => `https://www.law.go.kr/법령/${encodeURIComponent(name.replace(/\s/g, ""))}/${encodeURIComponent(label)}`;

/** 조문 응답(lawService target=lawjosub)을 글자로 편다. 다른 법령·조문(가지번호 포함)이면 null */
export function parseArticle(raw: unknown, name: string, article: number, branch = 0): ParsedLaw | null {
  const law = record(record(raw)?.["법령"]);
  const info = record(law?.["기본정보"]);
  const units = list(record(law?.["조문"])?.["조문단위"]);
  const unit = units.find((u) => u["조문여부"] === "조문") ?? units[0];
  if (!info || !unit || text(info["법령명_한글"]) !== name || text(unit["조문번호"]) !== String(article)) return null;
  if (Number(text(unit["조문가지번호"]) || 0) !== branch) return null;
  const head = text(unit["조문내용"]);
  const heading = /^제\d+조(?:의\d+)?(?:\([^)]*\))?/.exec(head)?.[0] ?? head;
  const lines = [head.slice(heading.length).trim()];
  for (const p of list(unit["항"])) {
    lines.push(text(p["항내용"]));
    for (const h of list(p["호"])) {
      lines.push(text(h["호내용"]));
      for (const m of list(h["목"])) lines.push(text(m["목내용"]));
    }
  }
  const body = lines.filter(Boolean).join("\n");
  if (!heading || !body) return null;
  return { lawName: name, heading, text: body, url: lawUrl(name, `제${article}조${branch ? `의${branch}` : ""}`), effectiveDate: dateOf(unit["조문시행일자"]) ?? dateOf(info["시행일자"]) };
}

/** 법령 전체 응답(lawService target=law)에서 별표를 꺼낸다. 별표내용이 글자로 온 것만 */
export function parseAnnexes(raw: unknown, name: string): (ParsedLaw & { annex: number })[] {
  const law = record(record(raw)?.["법령"]);
  const info = record(law?.["기본정보"]);
  if (text(info?.["법령명_한글"]) !== name) return [];
  return list(record(law?.["별표"])?.["별표단위"])
    .filter((u) => !u["별표구분"] || text(u["별표구분"]) === "별표")
    .map((u) => {
      const annex = Number(text(u["별표번호"])) || 0;
      const title = text(u["별표제목"]).replace(/^\[별표\s*\d+[^\]]*\]\s*/, "");
      return { annex, lawName: name, heading: `별표${annex}${title ? `(${title})` : ""}`, text: text(u["별표내용"]).slice(0, MAX_TEXT), url: lawUrl(name, `별표${annex}`), effectiveDate: dateOf(info?.["시행일자"]) };
    })
    .filter((a) => a.annex > 0 && a.text.length > 0);
}

/** 법령 검색 응답(lawSearch target=law)에서 이름이 꼭 같은 현행 법령의 ID */
export function parseLawId(raw: unknown, name: string): string | null {
  const hit = list(record(record(raw)?.["LawSearch"])?.["law"]).find((x) => text(x["법령명한글"]) === name);
  return hit ? text(hit["법령ID"]) || null : null;
}

/**
 * 인증 실패·IP 미등록 등 거절 응답이면 원인을 한국어로 돌려준다(이 API는 거절도 HTTP 200 글자로 준다). 정상이면 null.
 * 응답 문구는 공개 사례 기준이라 바뀔 수 있다. 모르는 모양이면 마지막 줄의 일반 안내를 준다.
 */
export function authProblem(body: string): string | null {
  const t = body.replace(/\s+/g, " ");
  if (/검증에\s*실패|사용자\s*정보/.test(t)) return "인증 실패: .env.local의 LAW_OC 값이 틀렸거나, 이 컴퓨터의 IP가 open.law.go.kr에 등록되지 않았습니다(docs/법령-갱신.md 3번).";
  if (/등록된\s*사용자에게만|허용되지\s*않은\s*IP|IP\s*(?:가|이)?\s*(?:등록|일치)/.test(t)) return "IP 미등록: 지금 이 컴퓨터의 IP가 open.law.go.kr에 등록한 IP와 다릅니다(docs/법령-갱신.md 3번).";
  if (/미신청|신청하지\s*않/.test(t)) return "API 미신청: open.law.go.kr에서 법령(현행법령) Open API를 신청하지 않았습니다(docs/법령-갱신.md 3번).";
  if (/필수\s*입력값/.test(t)) return "필수 값 없음: OC 값이 비었거나 요청 모양이 바뀌었습니다.";
  const trimmed = t.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "알아볼 수 없는 응답: JSON이 아닌 글자가 왔습니다. 인증·IP 등록을 확인하세요(docs/법령-갱신.md 3번).";
  return null;
}
