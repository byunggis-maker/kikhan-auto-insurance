import { describe, expect, it, vi } from "vitest";
import { newCoverage, newDraft, newPerson, parseLegacyDraft } from "@/lib/draft/store";
import { toClaim } from "@/lib/draft/to-claim";
import type { CaseDraft } from "@/lib/draft/types";
import { summarize } from "@/lib/engine/summarize";
import type { MatrixCell } from "@/lib/engine/types";
import { defaultExplanation } from "@/lib/explain/default";
import { EXPLAIN_INSTRUCTIONS, explainCell, explainFacts, explainRequestText, renderExplanation } from "@/lib/explain/llm";
import { chunkText, documentSpeech, resultSpeech } from "@/lib/explain/speech-text";
import { buildBook, DISCLAIMER, EXCLUDED_LABEL } from "@/lib/export/book";
import { buildImagePdf, summaryLines } from "@/lib/export/pdf";
import { toXlsx } from "@/lib/export/xlsx";
import { computeResult, type Result } from "@/lib/result/compute";
import { fieldHref } from "@/lib/result/field-link";
import { ENGINE_VERSION, RULES_VERSION } from "@/lib/rules/version";
import { SpeechPlayer, type AudioLike, type PlayerState } from "@/lib/speech/player";
import { MAX_TTS_TEXT, synthesize, ttsConfig } from "@/lib/speech/tts";
import { rulesHash } from "@/scripts/rules-version.mjs";

// 8단계: 화면 입력 → 엔진 → 결과 화면·설명·읽어주기·내려받기. 사람과 금액은 모두 지어낸 가상 사례다.

/** 회귀 사례(docs/PLAN.md): 자동차상해, 치료비 5,500,000원, 상해 7급, 통원 3일, 휴업손해 0 확인, 부상 한도 "3천만원" */
function regressionDraft(): CaseDraft {
  const draft = newDraft("11111111-1111-4111-8111-111111111111", "2026-10-14T00:00:00.000Z");
  const driver = { ...newPerson("p1", "driver"), injuryGrade: 7, treatmentCost: 5_500_000, outpatientDays: 3, hospitalDays: 0, daysOffWork: 0, occupation: "회사원", faultPercent: 100 };
  return {
    ...draft,
    accident: { ...draft.accident, date: "2026-09-01", kind: "single" },
    policy: {
      ...draft.policy,
      insurer: "가상화재",
      productLine: "personal",
      riders: ["긴급출동서비스 특약"],
      coverages: [
        { ...newCoverage("c1", "자동차상해"), joined: true, limit: "사망/후유장애 2억원 부상 3천만원" },
        { ...newCoverage("c2", "자기차량손해"), joined: true, limit: "차량가액 2,500만원 한도", deductible: "50만원" },
        { ...newCoverage("c3", "대인배상Ⅱ"), joined: true, limit: "무한" },
        newCoverage("c4", "자기신체사고"),
      ],
    },
    people: [driver],
    vehicle: { ...draft.vehicle, repairCost: 5_000_000 },
  };
}

function result(draft = regressionDraft()): Result {
  const computed = computeResult(draft);
  if (!computed.ok) throw new Error("계산되지 않음");
  return computed.result;
}
const cellOf = (r: Result, coverage: string) => r.matrix.cells.find((cell) => cell.coverage === coverage) as MatrixCell;

describe("화면 입력을 엔진에 연결", () => {
  it("회귀 사례: 자동차상해 5,924,000원, 자기차량손해 4,500,000원 ('부상 3천만원'을 3원으로 읽지 않는다)", () => {
    const r = result();
    // 5,500,000 + 위자료 7급 400,000 + 통원 3일 × 8,000 = 5,924,000 (부상 한도 30,000,000 이내)
    expect(cellOf(r, "auto_injury").amount?.expected).toBe(5_924_000);
    expect(cellOf(r, "own_damage").amount?.expected).toBe(4_500_000);
    expect(r.summary.groups[0].total.expected).toBe(10_424_000);
    expect(r.summary).toEqual(summarize(r.matrix));
    // 증권에 있지만 규칙이 없는 특약
    expect(cellOf(r, "rider_other").reason).toBe("증권에 있으나 계산 규칙 미등록: 긴급출동서비스 특약");
    expect(r.rulesVersion).toBe(RULES_VERSION);
    expect(r.engineVersion).toBe(ENGINE_VERSION);
  });

  it("입력하지 않은 값은 0원이 아니라 '정보 부족'이고, 부족 정보는 해당 입력 칸으로 이어진다", () => {
    const draft = regressionDraft();
    draft.people[0] = { ...draft.people[0], treatmentCost: null };
    const cell = cellOf(result(draft), "auto_injury");
    expect(cell.status).toBe("insufficient_info");
    expect(cell.amount).toBeNull();
    expect(cell.missing.map((info) => fieldHref(draft.id, info.field, cell.rowId))).toContain(`/cases/${draft.id}/people#f-p1-treatmentCost`);
    // 사고 날짜나 보험 종류가 없으면 계산을 시작하지 않는다.
    const blank = toClaim({ ...draft, accident: { ...draft.accident, date: "" }, policy: { ...draft.policy, productLine: "" } });
    expect(blank).toMatchObject({ ok: false, missing: [{ field: "accident.date" }, { field: "policy.productLine" }] });
    expect(fieldHref(draft.id, "accident.date", "")).toBe(`/cases/${draft.id}/accident#f-accident-date`);
    expect(fieldHref(draft.id, "liable.propertyLimit", "p1")).toBe(`/cases/${draft.id}/accident#f-accident-counterpartyPropertyLimit`);
  });

  it("상대방 가입금액은 사고 화면에 적은 값만 쓰고, 내 증권의 한도를 대신 쓰지 않는다", () => {
    const draft = regressionDraft();
    draft.accident = { ...draft.accident, kind: "car_car", counterpartyInsurance: "full" };
    draft.people[0] = { ...draft.people[0], faultPercent: 30 };
    const claim = toClaim(draft);
    if (!claim.ok) throw new Error("계산되지 않음");
    // 내 대인배상Ⅱ는 "무한"이지만 상대방 한도는 모름(null)
    expect(claim.claim.persons[0].liable).toEqual({ status: "full", bodily2Limit: null });
    expect(claim.claim.vehicles[0].liable).toEqual({ status: "insured", propertyLimit: null });
    expect(cellOf(result(draft), "liability_bodily_2").reason).toContain("상대방 계약 확인 필요");
    const known = toClaim({ ...draft, accident: { ...draft.accident, counterpartyBodily2Limit: "무한", counterpartyPropertyLimit: "2억원" } });
    expect(known.ok && known.claim.persons[0].liable.bodily2Limit).toBe("unlimited");
    expect(known.ok && known.claim.vehicles[0].liable.propertyLimit).toBe(200_000_000);
  });
});

describe("왜 이 금액? (LLM 설명)", () => {
  const cell = cellOf(result(), "auto_injury");
  const facts = explainFacts(cell);

  it("프롬프트가 숫자를 새로 만들지 말고 자리표시만 쓰라고 지시한다", () => {
    expect(EXPLAIN_INSTRUCTIONS).toContain("숫자를 새로 만들지 않는다");
    expect(EXPLAIN_INSTRUCTIONS).toContain("{{키}} 자리표시로만");
    const text = explainRequestText("자동차상해", facts, []);
    expect(text).toContain("{{total}}");
    // 사람의 역할 이름도 보내지 않는다.
    expect(text).not.toContain("운전자(나)");
  });

  it("자리표시를 엔진의 값으로 바꿔 넣는다", () => {
    const medical = facts.find((fact) => fact.label === "치료관계비")?.key;
    expect(renderExplanation({ sentences: [`병원비 {{${medical}}}에 위자료 등을 더했습니다.`, "그래서 예상 금액은 {{total}}입니다."] }, facts)).toEqual(["병원비 5,500,000원에 위자료 등을 더했습니다.", "그래서 예상 금액은 5,924,000원입니다."]);
  });

  it("자리표시가 아닌 숫자·금액이 있거나 없는 키를 쓰면 설명을 버린다", () => {
    for (const sentences of [
      ["예상 금액은 5,924,000원입니다."],
      ["예상 금액은 {{total}}이고 위자료는 40만원입니다."],
      ["예상 금액은 {{total}}이고 위자료는 사십만원입니다."],
      ["예상 금액은 {{total}}입니다.", "상해 7급 기준입니다."],
      ["예상 금액은 {{grand_total}}입니다."],
      ["예상 금액은 {{total}} + {{ item1 }}입니다."],
      ["금액 이야기가 없는 문장입니다."],
    ])
      expect(renderExplanation({ sentences }, facts), sentences.join(" ")).toBeNull();
    expect(renderExplanation({ text: "모양이 다름" }, facts)).toBeNull();
  });

  it("버린 경우와 LLM이 실패한 경우에는 null을 돌려주고, 화면은 엔진 내역으로 만든 기본 문장을 쓴다", async () => {
    expect(await explainCell(cell, "자동차상해", [], async () => ({ sentences: ["총 6,000,000원입니다."] }))).toBeNull();
    expect(
      await explainCell(cell, "자동차상해", [], async () => {
        throw new Error("제공자 오류");
      }),
    ).toBeNull();
    expect(await explainCell(cell, "자동차상해", [], async () => ({ sentences: ["예상 금액은 {{total}}입니다."] }))).toEqual(["예상 금액은 5,924,000원입니다."]);
    const basic = defaultExplanation(cell, "자동차상해");
    expect(basic[0]).toBe("자동차상해의 예상 금액은 5,924,000원입니다.");
    expect(basic.some((sentence) => sentence.includes("7급 위자료 400,000원"))).toBe(true);
  });
});

describe("읽어주기", () => {
  it("결과 요약과 증권 내용을 글로 만든다. 이름·차량번호·증권번호는 넣지 않는다", () => {
    // v1 때 저장된 초안처럼 신원 칸이 남아 있어도, 옮겨 올 때 지워져 읽어주기 글에 들어가지 않는다.
    const plain = regressionDraft();
    const legacy = {
      ...plain,
      policy: { ...plain.policy, insuredName: "홍길동", vehicleNumber: "12가3456", policyNumber: "가상-0000" },
      people: plain.people.map((person) => ({ ...person, name: "가상 본인" })),
    };
    const draft = parseLegacyDraft(JSON.stringify(legacy))!;
    const text = [...resultSpeech(result(draft)), ...documentSpeech(draft.policy)].join("\n");
    expect(text).toContain("내가 받을 예상 보험금은 10,424,000원입니다.");
    expect(text).toContain("자동차상해, 가입금액 사망/후유장애 2억원 부상 3천만원.");
    expect(text).toContain("참고용 추정이며 손해사정이나 보험금 지급 확정이 아닙니다");
    for (const secret of ["가상 본인", "홍길동", "12가3456", "가상-0000"]) expect(text).not.toContain(secret);
  });

  it("긴 글은 한 번에 보낼 수 있는 길이로 나눈다", () => {
    const chunks = chunkText(["가".repeat(700), "나".repeat(700), "다".repeat(3000)], 1200);
    expect(chunks.every((chunk) => chunk.length <= 1200)).toBe(true);
    expect(chunks.join("").replace(/\n/g, "")).toHaveLength(4400);
  });

  it("음성 합성 요청: 설정이 없으면 막고, 주민등록번호 뒷자리는 가려서 보낸다", async () => {
    expect(() => ttsConfig({ OPENAI_API_KEY: "k" })).toThrow();
    const send = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const audio = await synthesize("번호는 800505-1234567 입니다", ttsConfig({ OPENAI_API_KEY: "k", TTS_MODEL: "m", TTS_VOICE: "v" }), send as unknown as typeof fetch);
    expect(new Uint8Array(audio)).toEqual(new Uint8Array([1, 2, 3]));
    const body = JSON.parse((send.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ model: "m", voice: "v", response_format: "mp3" });
    expect(body.input).not.toContain("1234567");
    await expect(synthesize("가".repeat(MAX_TTS_TEXT + 1), { key: "k", model: "m", voice: "v" }, send as unknown as typeof fetch)).rejects.toMatchObject({ code: "TOO_LARGE" });
    await expect(synthesize("글", { key: "k", model: "m", voice: "v" }, (async () => new Response("제공자 원문", { status: 500 })) as unknown as typeof fetch)).rejects.toMatchObject({ code: "TTS_FAILED" });
  });

  it("재생·멈춤·속도", async () => {
    const states: PlayerState[] = [];
    const audio: AudioLike & { played: number } = { src: "", playbackRate: 1, onended: null, played: 0, play: async () => void audio.played++, pause: vi.fn() };
    const fetchAudio = vi.fn(async (text: string) => `blob:${text}`);
    const released: string[] = [];
    const player = new SpeechPlayer({ chunks: ["하나", "둘"], fetchAudio, createAudio: () => audio, release: (url) => released.push(url), onState: (state) => states.push(state) });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    player.setSpeed(1.5);
    player.toggle();
    await settle();
    expect(states.at(-1)).toEqual({ phase: "playing" });
    expect(audio).toMatchObject({ src: "blob:하나", playbackRate: 1.5 });
    player.toggle();
    expect(states.at(-1)).toEqual({ phase: "paused" });
    expect(audio.pause).toHaveBeenCalled();
    player.toggle();
    await settle();
    expect(states.at(-1)).toEqual({ phase: "playing" });
    // 한 덩어리가 끝나면 다음 덩어리로 넘어가고, 다 끝나면 처음 상태로 돌아간다.
    audio.onended?.();
    await settle();
    expect(audio.src).toBe("blob:둘");
    audio.onended?.();
    await settle();
    expect(states.at(-1)).toEqual({ phase: "idle" });
    expect(fetchAudio).toHaveBeenCalledTimes(2);
    player.dispose();
    expect(released).toEqual(["blob:하나", "blob:둘"]);
  });
});

describe("내려받기", () => {
  const r = result();
  const book = buildBook(r, "2026-10-14");

  it("엑셀: 총괄표 + 사람별 시트 + 근거 시트. 합계는 합산 함수의 값이고 규칙 버전이 들어 있다", () => {
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(["총괄표", "운전자(나)", "근거"]);
    const overview = book.sheets[0].rows;
    expect(overview).toContainEqual(["규칙 파일 버전", RULES_VERSION]);
    expect(overview).toContainEqual(["내가 받을 예상 보험금", 10_424_000, 10_424_000, 10_424_000, 2]);
    expect(overview).toContainEqual(["상대방에게 지급될 예상 금액", "계산된 칸 없음", null, null, 0]);
    expect(overview.at(-1)).toEqual([DISCLAIMER]);
    const person = book.sheets[1].rows;
    expect(person).toContainEqual(["자동차상해", "계산됨", 5_924_000, 5_924_000, 5_924_000, "입력하지 않은 항목은 빼고 계산했습니다"]);
    expect(person.some((row) => row[0] === "  위자료(부상 7급)" && row[3] === 400_000)).toBe(true);
    expect(book.sheets[2].rows.some((row) => typeof row[2] === "string" && row[2].includes("현대해상 개인용 약관 2025-11-26 개정"))).toBe(true);
  });

  it("엑셀 파일로 만들어 다시 읽으면 같은 값이고, 수식은 없다", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await toXlsx(book));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["총괄표", "운전자(나)", "근거"]);
    const values: unknown[] = [];
    workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.value))));
    expect(values).toContain(10_424_000);
    expect(values.every((value) => value === null || typeof value === "string" || typeof value === "number")).toBe(true);
  });

  it("PDF 요약: 합계·담보별 금액·규칙 버전·하단 문구가 들어 있다", () => {
    const lines = summaryLines(r, "2026-10-14").map((line) => line.text);
    expect(lines).toContain("10,424,000원");
    expect(lines).toContain("자동차상해: 5,924,000원");
    expect(lines.some((line) => line.includes(RULES_VERSION))).toBe(true);
    expect(lines.at(-1)).toBe(DISCLAIMER);
  });

  // 비상 점검: 엑셀·PDF·읽어주기에 적힌 금액은 모두 엔진의 칸이나 합산 함수의 값이어야 한다. 그 밖의 숫자가 있으면 어디선가 다시 계산한 것이다.
  function engineAmounts(target: Result) {
    const values = new Set<number>();
    const add = (range: { min: number; expected: number; max: number } | null) => range && [range.min, range.expected, range.max].forEach((value) => values.add(value));
    for (const cell of target.matrix.cells) {
      add(cell.amount);
      for (const line of cell.lines) add(line.amount);
    }
    for (const group of target.summary.groups) {
      values.add(group.countedCells);
      if (group.countedCells > 0) add(group.total);
      for (const sum of [...group.byRow, ...group.byColumn]) if (sum.countedCells > 0) add(sum.amount);
    }
    return values;
  }
  function expectOnlyEngineAmounts(target: Result) {
    const allowed = engineAmounts(target);
    const targetBook = buildBook(target, "2026-10-14");
    for (const sheet of targetBook.sheets) for (const row of sheet.rows) for (const value of row) if (typeof value === "number") expect(allowed, `${sheet.name}: ${value}`).toContain(value);
    const texts = [...summaryLines(target, "2026-10-14").map((line) => line.text), ...resultSpeech(target), ...targetBook.sheets[0].rows.flat().filter((value): value is string => typeof value === "string" && value.includes(EXCLUDED_LABEL))];
    for (const text of texts) for (const match of text.matchAll(/([0-9][0-9,]*)원/g)) expect(allowed, text).toContain(Number(match[1].replaceAll(",", "")));
    return targetBook;
  }

  it("엑셀·PDF·읽어주기의 금액은 모두 엔진의 칸과 합산 함수의 값이다", () => {
    expectOnlyEngineAmounts(r);
  });

  it("합계에서 뺀 칸은 어디서나 '합계 제외'로 적고, 표의 숫자를 더하면 합산 함수의 합계와 같다", () => {
    const cells = r.matrix.cells.map((cell) => (cell.coverage === "own_damage" ? { ...cell, inTotal: false } : cell));
    const matrix = { ...r.matrix, cells };
    const changed: Result = { ...r, matrix, summary: summarize(matrix) };
    const [mine] = changed.summary.groups;
    expect(mine.total.expected).toBe(5_924_000);
    const overview = expectOnlyEngineAmounts(changed).sheets[0].rows;
    const head = overview.findIndex((row) => row[0] === "사람 × 담보 (예상 금액)");
    const tableRow = overview[head + 1];
    expect(tableRow.filter((value) => typeof value === "number")).toEqual([5_924_000]);
    expect(tableRow).toContain(`4,500,000원 (${EXCLUDED_LABEL})`);
    expect(summaryLines(changed, "2026-10-14").map((line) => line.text)).toContain(`자기차량손해: 4,500,000원 (${EXCLUDED_LABEL})`);
    expect(resultSpeech(changed).join("\n")).toContain("자기차량손해 4,500,000원, 이 금액은 합계에 넣지 않았습니다");
  });

  it("더한 칸이 없는 사람·담보의 합계는 0이 아니라 '계산된 칸 없음'이다", () => {
    const cells = r.matrix.cells.map((cell) => ({ ...cell, inTotal: false }));
    const matrix = { ...r.matrix, cells };
    const overview = buildBook({ ...r, matrix, summary: summarize(matrix) }, "2026-10-14").sheets[0].rows;
    expect(overview).toContainEqual(["운전자(나)", "내가 받을 예상 보험금", "계산된 칸 없음", null, null]);
    expect(overview).toContainEqual(["자동차상해", "내가 받을 예상 보험금", "계산된 칸 없음", null, null]);
  });

  it("PDF 파일: 쪽 그림을 넣은 올바른 구조를 만든다", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildImagePdf([
      { jpeg, width: 10, height: 14 },
      { jpeg, width: 10, height: 14 },
    ]);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(2);
    // xref의 위치가 실제 객체 위치와 맞는다.
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const first = Number(/\n(\d{10}) 00000 n /.exec(text.slice(xref))?.[1]);
    expect(text.slice(first, first + 7)).toBe("1 0 obj");
  });
});

describe("규칙 버전", () => {
  it("data/rules/version.json이 지금의 규칙 파일과 맞는다 (다르면 node scripts/rules-version.mjs 를 실행)", () => {
    expect(RULES_VERSION).toBe(rulesHash().version);
    expect(RULES_VERSION).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
