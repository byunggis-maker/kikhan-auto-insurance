import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { NOT_FOUND, verifyAnswer, type Answer, type LawSource } from "@/lib/ai/ask";
import { emptyClaim, type Claim } from "@/lib/claim/types";
import { calculate } from "@/lib/engine/dual-run";
import { reviewToXlsx } from "@/lib/export/excel";
import { PDF_FONT_FILES, reviewToPdf } from "@/lib/export/pdf";
import { NEEDS_UPDATE, asOfText, isStale, lawsInText, type LawIndex } from "@/lib/law/data";
import { SITE } from "@/lib/law/parse";
import { refsFromText, wantedRefs } from "@/lib/law/refs";
import { PARTIAL_NOTE, buildReview } from "@/lib/report/review";
import { counterpartyOf, setItem, setOtherCount, setPersonFacts, setVictimCount } from "@/lib/ui/flow";
import { LawFetchError, codeTexts, fetchLaws, readOc, writeLaws } from "../../scripts/fetch-laws.ts";
import { TEST_TMP } from "../setup";

// 라운드 9d: 미계산 합계 안전장치, 법령 원문 미리받기(스크립트·앱 묶음·원문 기준일·갱신 필요).

const base = (status: "full" | "uninsured" = "full"): Claim => ({
  ...emptyClaim(),
  accident: { ...emptyClaim().accident, occurredAt: "2026-10-01", type: "car_car" },
  myPolicy: { ...emptyClaim().myPolicy, productLine: "personal", coverages: [{ coverage: "liability_bodily_1", limit: null, injuryLimit: null, deathLimit: null, disabilityLimit: null }, { coverage: "liability_bodily_2", limit: "unlimited", injuryLimit: null, deathLimit: null, disabilityLimit: null }] },
  counterpartyPolicy: counterpartyOf(emptyClaim(), status),
});
/** 피보험자(나)와 상대 차량 동승자 1명이 다친 사고(둘 다 5급, 위자료 100만 원 확정) */
const passenger = (seat: "passenger" | "passenger_family", status: "full" | "uninsured" = "full") => {
  const c = setPersonFacts(setOtherCount(setVictimCount(base(status), "driver", 1), 1), "other-1", { seat });
  const graded = { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 5 })) };
  return setItem(setItem(graded, "other-1", "solatium_injury", { confirmed: 1_000_000 }), "driver-1", "solatium_injury", { confirmed: 1_000_000 });
};
const partialWon = (n: number) => `${n.toLocaleString("ko-KR")}원 + 미계산`;
const reviewOf = (c: Claim) => buildReview(c, [calculate(c, 30)], 0);
const FONT_DIR = "node_modules/pretendard/dist/public/static/alternative";
const fonts = { regular: new Uint8Array(readFileSync(`${FONT_DIR}/${PDF_FONT_FILES.regular}`)), bold: new Uint8Array(readFileSync(`${FONT_DIR}/${PDF_FONT_FILES.bold}`)) };

async function pdfText(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  let all = "";
  for (let i = 1; i <= doc.numPages; i++) all += (await (await doc.getPage(i)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join("") + "\n";
  return all;
}

describe("미계산 합계 안전장치", () => {
  for (const [name, claim] of [
    ["상대 운전자 가족 동승자", () => passenger("passenger_family")],
    ["무보험 상대 차 동승자", () => passenger("passenger", "uninsured")],
  ] as const) {
    it(`${name}: 합계가 확정 숫자로 보이지 않는다(엑셀·PDF)`, async () => {
      const review = reviewOf(claim());
      expect(review.partial).toBe(true);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load((await reviewToXlsx(review)).buffer as ArrayBuffer);
      const summary = book.getWorksheet("요약")!;
      const receive = summary.getRows(1, summary.rowCount)!.find((r) => r.getCell(1).value === "받을 돈")!;
      expect(review.top.receiveConfirmed).toBeGreaterThan(0);
      expect([receive.getCell(2).value, receive.getCell(3).value]).toEqual([partialWon(review.top.receiveConfirmed), partialWon(review.top.receiveWithEstimates)]);
      expect(receive.getCell(4).value).toBe(PARTIAL_NOTE);
      const payer = review.byPayer[0];
      const byPayer = summary.getRows(1, summary.rowCount)!.find((r) => r.getCell(1).value === payer.payer)!;
      expect(byPayer.getCell(3).value).toBe(partialWon(payer.withEstimates));
      const text = (await pdfText(await reviewToPdf(review, fonts))).replace(/\s+/g, "");
      expect(text).toContain(partialWon(review.top.receiveConfirmed).replace(/\s+/g, ""));
      expect(text).toContain(PARTIAL_NOTE.replace(/\s+/g, ""));
    });
  }

  it("미계산이 없으면 그대로 숫자", async () => {
    const review = reviewOf(passenger("passenger"));
    expect(review.partial).toBe(false);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await reviewToXlsx(review)).buffer as ArrayBuffer);
    const summary = book.getWorksheet("요약")!;
    expect(summary.getRows(1, summary.rowCount)!.find((r) => r.getCell(1).value === "받을 돈")!.getCell(2).value).toBe(review.top.receiveConfirmed);
    expect(review.top.receiveConfirmed).toBeGreaterThan(0);
  });
});

describe("앱이 인용하는 법령 조문 목록", () => {
  it("코드 글자에서 법 이름·조문·가지번호·시행령 별표를 찾는다", () => {
    expect(refsFromText("자동차손해배상보장법 제30조, 민법 제760조, 상법 제726조의2, 시행령 [별표 1], 자동차손해배상보장법 시행령 제3조, 보통약관 제8조").map((r) => r.id)).toEqual(["act-30", "civil-760", "commercial-726-2", "decree-3", "decree-annex-1"]);
    expect(refsFromText("손해배상법 제3조")).toEqual([]);
  });

  it("지금 코드에서 모은 목록에 기본 조문(민법 760·763·396 등)과 코드의 인용이 모두 들어 있다", () => {
    const ids = wantedRefs(codeTexts()).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["act-5", "act-30", "decree-3", "decree-annex-1", "decree-annex-2", "civil-396", "civil-760", "civil-763", "commercial-726-2"]));
  });
});

// 국가법령정보센터 응답 모양을 본뜬 가짜 서버
function fakeServer(mode: "ok" | "auth" = "ok") {
  const seen: { url: URL; headers: unknown }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, headers: init?.headers });
    if (mode === "auth") return new Response("사용자 정보 검증에 실패하였습니다.", { status: 200 });
    const p = Object.fromEntries(url.searchParams);
    if (url.pathname.endsWith("lawSearch.do")) return Response.json({ LawSearch: { law: [{ 법령명한글: p.query, 법령ID: p.query === "민법" ? "001706" : "000001" }] } });
    if (p.target === "lawjosub" && p.JO === "076000")
      return Response.json({ 법령: { 기본정보: { 법령명_한글: "민법", 시행일자: "20250131" }, 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "760", 조문내용: "제760조(공동불법행위자의 책임) ① 수인이 공동의 불법행위로 타인에게 손해를 가한 때에는 연대하여 그 손해를 배상할 책임이 있다." }] } } });
    return Response.json({});
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

describe("법령 원문 미리받기 스크립트", () => {
  const now = () => new Date("2026-11-19T03:00:00Z");
  const civil760 = refsFromText("민법 제760조");

  it("받은 조문에 법령명·조문·원문·시행일·받은 날짜·출처 URL을 적고, 등록 도메인을 Referer로 싣는다", async () => {
    const { fetch, seen } = fakeServer();
    const { records, failed } = await fetchLaws([...civil760, ...refsFromText("민법 제763조")], { fetch, oc: "test", now });
    expect(records).toEqual([
      { id: "civil-760", label: "제760조", lawName: "민법", heading: "제760조(공동불법행위자의 책임)", text: "① 수인이 공동의 불법행위로 타인에게 손해를 가한 때에는 연대하여 그 손해를 배상할 책임이 있다.", effectiveDate: "2025-01-31", fetchedAt: "2026-11-19", url: expect.stringContaining("law.go.kr") },
    ]);
    expect(failed).toEqual([{ id: "civil-763", reason: "민법 제763조 원문이 응답에 없습니다" }]);
    expect(seen.every((s) => (s.headers as Record<string, string>).Referer === SITE)).toBe(true);
  });

  it("인증 실패·IP 미등록이면 한국어 원인으로 멈춘다(파일을 쓰지 않는다)", async () => {
    await expect(fetchLaws(civil760, { fetch: fakeServer("auth").fetch, oc: "wrong", now })).rejects.toThrow(LawFetchError);
    await expect(fetchLaws(civil760, { fetch: fakeServer("auth").fetch, oc: "wrong", now })).rejects.toThrow(/인증 실패: .*IP가 open\.law\.go\.kr에 등록되지/);
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof globalThis.fetch;
    await expect(fetchLaws(civil760, { fetch: offline, oc: "x", now })).rejects.toThrow(/인터넷 연결 실패/);
  });

  it("파일 쓰기: 조문마다 파일 + index.json. 못 받은 조문의 예전 기록은 남는다", () => {
    const dir = join(TEST_TMP, "laws-9d");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const old = { id: "civil-763", lawName: "민법", label: "제763조", heading: "제763조(준용규정)", text: "예전 원문", effectiveDate: null, fetchedAt: "2026-01-01", url: "https://www.law.go.kr/" };
    writeFileSync(join(dir, "index.json"), JSON.stringify({ generatedAt: null, wanted: [], articles: [old] }));
    const fresh = { ...old, id: "civil-760", label: "제760조", heading: "제760조", text: "새 원문", fetchedAt: "2026-11-19" };
    const index = writeLaws(dir, ["civil-760", "civil-763"], [fresh], now());
    expect(index.articles.map((a) => a.id)).toEqual(["civil-760", "civil-763"]);
    expect(existsSync(join(dir, "civil-760.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "index.json"), "utf8")).articles[1].text).toBe("예전 원문");
  });

  it("OC는 .env.local의 LAW_OC에서 읽는다", () => {
    expect(readOc("ANTHROPIC_API_KEY=x\nLAW_OC=abc123\n")).toBe("abc123");
    expect(readOc("LAW_API_OC=zzz")).toBeNull();
  });
});

describe("앱의 법령 원문 표시", () => {
  const record = { id: "act-30", lawName: "자동차손해배상 보장법", label: "제30조", heading: "제30조(자동차손해배상 보장사업)", text: "① 정부는 다음 각 호의 어느 하나에 해당하는 경우에는 피해자의 청구에 따라 보상한다.", effectiveDate: "2025-06-01", fetchedAt: "2026-11-19", url: "https://www.law.go.kr/" };
  const data: LawIndex = { generatedAt: "2026-11-19", wanted: ["act-30", "act-5"], articles: [record] };

  it("원문이 있으면 원문 기준일과 시행일, 없거나 180일이 넘으면 '원문 갱신 필요'", () => {
    const views = lawsInText("자동차손해배상보장법 제30조 / 자동차손해배상보장법 제5조", "2026-11-20", data);
    expect(views.map((v) => [v.ref.id, v.record !== null, v.stale])).toEqual([
      ["act-30", true, false],
      ["act-5", false, true],
    ]);
    expect(asOfText(record)).toBe("원문 기준일: 2026-11-19 (시행일 2025-06-01)");
    expect(isStale("2026-01-01", "2026-06-30")).toBe(false);
    expect(isStale("2026-01-01", "2026-07-01")).toBe(true);
  });

  it("약관 질의: 앱에 든 원문으로 대조하고 기준일을 붙인다. 원문이 없는 조문은 '원문 갱신 필요'", () => {
    const laws: LawSource[] = [{ ...record, stale: false }];
    const answer: Answer = {
      conclusion: "",
      issues: [],
      interpretation: "",
      basis: [
        { kind: "법령", citation: "자동차손해배상보장법 제30조", page: null, quote: "피해자의 청구에 따라 보상한다" },
        { kind: "법령", citation: "민법 제760조", page: null, quote: "" },
        { kind: "법령", citation: "자동차손해배상 보장법 제999조", page: null, quote: "" },
      ],
      nextSteps: [],
    };
    const v = verifyAnswer(answer, [], laws);
    expect(v.basis[0]).toMatchObject({ verified: true, quote: "피해자의 청구에 따라 보상한다", asOf: "원문 기준일: 2026-11-19 (시행일 2025-06-01)", stale: false });
    expect(v.basis[1].citation).toBe(`민법 제760조 — ${NEEDS_UPDATE}`);
    expect(v.basis[2].citation).toBe(`자동차손해배상 보장법 제999조 — ${NOT_FOUND}`);
    expect(v.basis.at(-1)?.citation).toBe(`관련 판례 — ${NOT_FOUND}`);
    expect(verifyAnswer({ ...answer, basis: [] }, [], []).basis[0].citation).toBe(`자동차손해배상 보장법·시행령 별표, 민법, 상법 — ${NEEDS_UPDATE}`);
  });
});
