import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as usage } from "@/app/api/usage/route";
import type { ClaimReading } from "@/lib/ai/documents";
import { DAILY_AI_LIMIT, remainingDailyUses, resetDailyUses, takeDailyUse } from "@/lib/ai/limits";
import { SALARY_INCOME_PERIOD } from "@/lib/claim/standards";
import { emptyClaim, type Claim, type Recognition } from "@/lib/claim/types";
import { setVictimCount } from "@/lib/ui/flow";
import { addRecognitions, claimRecognitions, confirmRecognition, countPeriodDays, factDiffers } from "@/lib/ui/recognize";
import { MAX_PDF_PAGES, UPLOAD_LIMIT, pdfPlan, pdfUseNotice } from "@/lib/ui/upload";

// 라운드 8c 지시 4: 급여 3장 평균, 기간으로 날수 합치기(겹치는 날 한 번), 기간 없는 서류 섞임, 한도 30회와 큰 PDF 사전 안내.

let n = 0;
const makeId = () => `f${++n}`;
const base = (occurredAt = "2026-09-01"): Claim => {
  const c = setVictimCount({ ...emptyClaim(), accident: { ...emptyClaim().accident, occurredAt, type: "car_car" } }, "driver", 1);
  return { ...c, victims: c.victims.map((v) => ({ ...v, injuryGrade: 9 })) };
};
const facts: ClaimReading["facts"] = { hospitalDays: null, outpatientDays: null, daysOffWork: null, hospitalPeriods: null, outpatientDates: null, daysOffWorkPeriods: null, incomeMonth: null, monthlyIncome: null };
const doc = (documentType: string, f: Partial<ClaimReading["facts"]>): ClaimReading => ({ documentType, issuer: null, documentDate: null, amounts: [], facts: { ...facts, ...f }, note: "" });
const read = (claim: Claim, ...docs: ClaimReading[]) => docs.reduce((c, d) => addRecognitions(c, claimRecognitions(c, "driver-1", d, makeId).recognitions), claim);
const fact = (c: Claim, field: string) => c.recognized.find((r): r is Extract<Recognition, { kind: "fact" }> => r.kind === "fact" && r.field === field)!;

describe("월 소득: 사고 직전 최근 3개월 평균(급여소득자)", () => {
  it("근거 조항: 별표1 가. 사망 3. 나.(1)(가)① 인쇄 72쪽, 휴업손해 다.(1)(가) 77쪽, 후유장애 78쪽", () => {
    expect(SALARY_INCOME_PERIOD.months).toBe(3);
    expect([SALARY_INCOME_PERIOD.basis.page, SALARY_INCOME_PERIOD.lostIncomeBasis.page, SALARY_INCOME_PERIOD.disabilityBasis.page]).toEqual([72, 77, 78]);
  });

  it("급여명세서 3장(6·7·8월) → 평균, 계산식을 보여 준다", () => {
    const c = read(base(), doc("급여명세서", { monthlyIncome: 3_000_000, incomeMonth: "2026-06" }), doc("급여명세서", { monthlyIncome: 3_100_000, incomeMonth: "2026-07" }), doc("급여명세서", { monthlyIncome: 3_200_001, incomeMonth: "2026-08" }));
    const r = fact(c, "monthlyIncome");
    expect(c.recognized.filter((x) => x.kind === "fact" && x.field === "monthlyIncome")).toHaveLength(1);
    // (3,000,000 + 3,100,000 + 3,200,001) ÷ 3 = 3,100,000.33… → 원 미만 버림
    expect(r.value).toBe(3_100_000);
    expect(r.formula).toMatch(/^6월·7월·8월 평균 \(3,000,000 \+ 3,100,000 \+ 3,200,001\) ÷ 3 = 3,100,000원/);
    expect(r.formula).toContain("인쇄 72쪽");
    expect(factDiffers(r)).toBe(false);
    // 확인 전에는 사람 칸이 비어 있고, 확인하면 평균이 들어간다
    expect(c.victims[0].monthlyIncome).toBeNull();
    expect(confirmRecognition(c, r.id).victims[0].monthlyIncome).toBe(3_100_000);
  });

  it("4장 이상이면 사고 달 이전의 최근 3개월만. 사고 달·뒤 달은 넣지 않는다", () => {
    const c = read(
      base("2026-09-15"),
      doc("급여명세서", { monthlyIncome: 9_000_000, incomeMonth: "2026-05" }),
      doc("급여명세서", { monthlyIncome: 3_000_000, incomeMonth: "2026-06" }),
      doc("급여명세서", { monthlyIncome: 3_000_000, incomeMonth: "2026-07" }),
      doc("급여명세서", { monthlyIncome: 3_300_000, incomeMonth: "2026-08" }),
      doc("급여명세서", { monthlyIncome: 9_000_000, incomeMonth: "2026-09" }),
    );
    const r = fact(c, "monthlyIncome");
    expect(r.value).toBe(3_100_000);
    expect(r.formula).toMatch(/^6월·7월·8월 평균/);
  });

  it("급여 월을 모르면 서류 전체 평균", () => {
    const r = fact(read(base(), doc("원천징수영수증", { monthlyIncome: 3_000_000 }), doc("급여명세서", { monthlyIncome: 3_500_000 })), "monthlyIncome");
    expect(r.value).toBe(3_250_000);
    expect(r.formula).toMatch(/^서류 평균/);
  });
});

describe("날수: 기간을 날짜로 합친다", () => {
  it("9/1~9/5 + 10/1~10/3 = 8일(겹치지 않으면 더한다)", () => {
    const r = fact(read(base(), doc("진단서", { hospitalDays: 5, hospitalPeriods: [{ start: "2026-09-01", end: "2026-09-05" }] }), doc("진료비 영수증", { hospitalDays: 3, hospitalPeriods: [{ start: "2026-10-01", end: "2026-10-03" }] })), "hospitalDays");
    expect(r.value).toBe(8);
    expect(r.formula).toBe("9/1~9/5 + 10/1~10/3 = 8일");
    expect(factDiffers(r)).toBe(false);
  });

  it("9/1~9/5 + 9/3~9/7 = 7일(겹치는 9/3~9/5는 한 번)", () => {
    const r = fact(read(base(), doc("진단서", { hospitalDays: 5, hospitalPeriods: [{ start: "2026-09-01", end: "2026-09-05" }] }), doc("진료비 영수증", { hospitalDays: 5, hospitalPeriods: [{ start: "2026-09-03", end: "2026-09-07" }] })), "hospitalDays");
    expect(r.value).toBe(7);
    expect(r.formula).toBe("9/1~9/5 + 9/3~9/7 = 7일(겹치는 3일은 한 번만)");
  });

  it("휴업 기간·통원 날짜도 같은 방식", () => {
    const c = read(
      base(),
      doc("휴업증명서", { daysOffWork: 10, daysOffWorkPeriods: [{ start: "2026-09-01", end: "2026-09-10" }], outpatientDays: 2, outpatientDates: ["2026-09-11", "2026-09-15"] }),
      doc("진단서", { daysOffWork: 10, daysOffWorkPeriods: [{ start: "2026-09-06", end: "2026-09-15" }], outpatientDays: 2, outpatientDates: ["2026-09-15", "2026-09-20"] }),
    );
    expect(fact(c, "daysOffWork").value).toBe(15);
    expect(fact(c, "outpatientDays").value).toBe(3);
  });

  it("기간을 읽지 못한 서류가 섞이면 지금처럼 큰 값 + '서류마다 다르게'", () => {
    const r = fact(read(base(), doc("진단서", { hospitalDays: 5, hospitalPeriods: [{ start: "2026-09-01", end: "2026-09-05" }] }), doc("진료비 영수증", { hospitalDays: 3 })), "hospitalDays");
    expect(r.value).toBe(5);
    expect(r.formula).toBeUndefined();
    expect(factDiffers(r)).toBe(true);
  });

  it("날짜가 이상한 기간은 읽지 못한 것으로 본다", () => {
    const r = fact(read(base(), doc("진단서", { hospitalDays: 5, hospitalPeriods: [{ start: "2026-09-05", end: "2026-09-01" }] }), doc("진료비 영수증", { hospitalDays: 3, hospitalPeriods: [{ start: "2026-10-01", end: "2026-10-03" }] })), "hospitalDays");
    expect(r.value).toBe(5);
    expect(factDiffers(r)).toBe(true);
  });

  it("countPeriodDays: 시작·종료일 포함, 달을 넘어도 센다", () => {
    expect(countPeriodDays([{ start: "2026-09-28", end: "2026-10-02" }])).toBe(5);
    expect(countPeriodDays([{ start: "2026-09-01", end: "2026-09-01" }])).toBe(1);
  });
});

describe("하루 한도 30회와 큰 PDF 사전 안내", () => {
  beforeEach(() => resetDailyUses());
  afterEach(() => vi.useRealTimers());

  it("IP당 하루 30회: 30회까지 쓰고 31번째는 막는다. 남은 횟수는 세지 않고 본다", () => {
    expect(DAILY_AI_LIMIT).toBe(30);
    const now = new Date("2026-10-22T03:00:00Z");
    expect(remainingDailyUses("1.1.1.1", now)).toBe(30);
    for (let i = 0; i < 28; i++) takeDailyUse("1.1.1.1", now);
    expect(remainingDailyUses("1.1.1.1", now)).toBe(2);
    expect(remainingDailyUses("1.1.1.1", now)).toBe(2);
    takeDailyUse("1.1.1.1", now);
    expect(takeDailyUse("1.1.1.1", now)).toBe(true);
    expect(takeDailyUse("1.1.1.1", now)).toBe(false);
    expect(remainingDailyUses("1.1.1.1", now)).toBe(0);
  });

  it("/api/usage는 남은 횟수를 돌려주고 세지 않는다", async () => {
    for (let i = 0; i < 4; i++) takeDailyUse("2.2.2.2");
    const request = () => new Request("http://localhost/api/usage", { headers: { "x-forwarded-for": "2.2.2.2" } });
    expect(await (await usage(request())).json()).toEqual({ ok: true, limit: 30, remaining: 26 });
    expect(await (await usage(request())).json()).toMatchObject({ remaining: 26 });
  });

  it("큰 PDF는 쪽 수만큼(최대 5회) 쓴다고 미리 알린다", async () => {
    const big = (bytes: number) => new File([new Uint8Array(bytes)], "big.pdf", { type: "application/pdf" });
    expect(await pdfPlan(big(5 * 1024 * 1024), async () => 3)).toEqual({ pages: 3, uses: 3 });
    expect(await pdfPlan(big(5 * 1024 * 1024), async () => 7)).toEqual({ pages: 7, uses: MAX_PDF_PAGES });
    expect(await pdfPlan(big(UPLOAD_LIMIT), async () => 3)).toBeNull();
    expect(pdfUseNotice({ pages: 3, uses: 3 }, 26)).toBe("이 PDF는 3회를 씁니다(오늘 남은 횟수 26회). 3쪽을 한 쪽씩 사진으로 바꿔 읽습니다.");
    expect(pdfUseNotice({ pages: 7, uses: 5 }, 30)).toBe("이 PDF는 5회를 씁니다(오늘 남은 횟수 30회). 전체 7쪽 중 앞 5쪽을 한 쪽씩 사진으로 바꿔 읽습니다.");
    expect(pdfUseNotice({ pages: 3, uses: 3 }, 2)).toBe("이 PDF는 3회를 씁니다(오늘 남은 횟수 2회). 3쪽을 한 쪽씩 사진으로 바꿔 읽습니다. 남은 횟수가 모자라 앞 2쪽까지만 읽습니다.");
    expect(pdfUseNotice({ pages: 3, uses: 3 }, null)).toBe("이 PDF는 3회를 씁니다. 3쪽을 한 쪽씩 사진으로 바꿔 읽습니다.");
  });
});
