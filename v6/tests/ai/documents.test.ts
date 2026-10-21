import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputError, ProviderError } from "@/lib/ai/anthropic";
import { CLAIM_INSTRUCTIONS, detectKind, readClaimDocument, readPolicyDocument, toContentBlock, type ReadCall } from "@/lib/ai/documents";
import { findSensitive } from "@/lib/privacy/mask";

// 라운드 7 서류 인식(제공자 호출은 가짜). 실제 호출 시험은 scripts/live-ai-check.mjs(키가 있을 때)와 round-7.md 표.

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/ai/${name}`));

/** 받은 요청을 기록하고, 정해 둔 답을 돌려주는 가짜 Claude */
function fakeCall(answer: unknown) {
  const seen: Parameters<ReadCall>[0][] = [];
  const call = (async (request: Parameters<ReadCall>[0]) => {
    seen.push(request);
    return { parsed: answer, usage: { inputTokens: 2000, outputTokens: 300, costUsd: 0.007 } };
  }) as ReadCall;
  return { call, seen };
}

describe("파일 형식(첫 바이트로 판단)", () => {
  it.each([
    ["receipt.pdf", "pdf"],
    ["receipt.jpg", "jpeg"],
    ["estimate.heic", "heic"],
  ])("%s → %s", (name, kind) => expect(detectKind(fixture(name))).toBe(kind));

  it("PDF는 문서 블록, JPEG는 그림 블록, HEIC는 JPEG로 바꾼 그림 블록", async () => {
    expect((await toContentBlock(fixture("receipt.pdf"))).block).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect((await toContentBlock(fixture("receipt.jpg"))).block).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
    const heic = await toContentBlock(fixture("estimate.heic"));
    expect(heic.kind).toBe("heic");
    expect(heic.block).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
    const data = (heic.block as { source: { data: string } }).source.data;
    expect(detectKind(new Uint8Array(Buffer.from(data, "base64")))).toBe("jpeg");
  });

  it("빈 파일·큰 파일·모르는 형식은 고칠 수 있는 오류(4xx)", async () => {
    await expect(toContentBlock(new Uint8Array())).rejects.toMatchObject({ status: 400 });
    await expect(toContentBlock(new Uint8Array(4 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 });
    await expect(toContentBlock(new TextEncoder().encode("hello world"))).rejects.toBeInstanceOf(InputError);
  });
});

describe("보상 서류 읽기", () => {
  it("구조화 출력 스키마로 부르고, 응답의 개인정보는 가린다(제공자가 규칙을 어겨도)", async () => {
    const { call, seen } = fakeCall({
      documentType: "진료비 영수증",
      amounts: [{ code: "treatment", amount: 2_000_000, basis: "진료비 총액(환자 900101-1234567, 010-1234-5678)" }],
      facts: { hospitalDays: 5, outpatientDays: 4, monthlyIncome: null },
      note: "",
    });
    const result = await readClaimDocument(fixture("receipt.jpg"), "person", call);
    expect(seen[0].system).toBe(CLAIM_INSTRUCTIONS);
    expect(seen[0].block).toMatchObject({ type: "image" });
    expect(result.fileKind).toBe("jpeg");
    expect(result.reading.amounts[0]).toMatchObject({ code: "treatment", amount: 2_000_000 });
    expect(result.reading.facts).toEqual({ hospitalDays: 5, outpatientDays: 4, monthlyIncome: null });
    expect(findSensitive(JSON.stringify(result.reading))).toEqual([]);
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it("사람 카드와 물건 카드는 옮길 수 있는 항목이 다르다(스키마가 막는다)", async () => {
    const { call, seen } = fakeCall({ documentType: "견적서", amounts: [], facts: { hospitalDays: null, outpatientDays: null, monthlyIncome: null }, note: "" });
    await readClaimDocument(fixture("estimate.heic"), "property", call);
    expect(seen[0].schema.safeParse({ documentType: "x", amounts: [{ code: "treatment", amount: 1, basis: "" }], facts: { hospitalDays: null, outpatientDays: null, monthlyIncome: null }, note: "" }).success).toBe(false);
    expect(seen[0].schema.safeParse({ documentType: "x", amounts: [{ code: "repair", amount: 1, basis: "" }], facts: { hospitalDays: null, outpatientDays: null, monthlyIncome: null }, note: "" }).success).toBe(true);
  });

  it("증권: 보험사 이름 안의 증권번호도 가린다", async () => {
    const { call } = fakeCall({ isPolicy: true, insurer: "가상화재 2026-123456789", productLine: "personal", driverScope: "family", coverages: [], ownDamageDeductible: null, note: "" });
    const result = await readPolicyDocument(fixture("policy.jpg"), call);
    expect(result.reading.insurer).toBe("가상화재 ●●●●-●●●●●●●●●");
  });
});

// ── 라우트: 키가 없거나 제공자가 실패하면 503 "준비 중", 입력 오류는 4xx ──
vi.mock("@/lib/ai/documents", async (original) => {
  const actual = await original<typeof import("@/lib/ai/documents")>();
  return { ...actual, claudeCall: () => (async () => Promise.reject(new ProviderError("down"))) as ReadCall };
});

describe("서류 인식 라우트", () => {
  afterEach(() => vi.unstubAllEnvs());
  const post = async (form?: FormData) => {
    const { POST } = await import("@/app/api/documents/read/route");
    return POST(new Request("http://localhost/api/documents/read", { method: "POST", body: form }));
  };
  const formWith = (name: string, kind: string, target?: string) => {
    const form = new FormData();
    form.set("file", new Blob([fixture(name)]));
    form.set("kind", kind);
    if (target) form.set("target", target);
    return form;
  };

  it("키가 없으면 503 '준비 중'", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const response = await post(formWith("receipt.jpg", "claim", "person"));
    expect(response.status).toBe(503);
    expect((await response.json()).message).toBe("이 기능은 준비 중입니다. 직접 입력해 주세요.");
  });

  it("키가 있어도 제공자가 실패하면 503 '준비 중'(응답 원문 없음)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    const response = await post(formWith("receipt.pdf", "claim", "person"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, reason: "unavailable", message: "이 기능은 준비 중입니다. 직접 입력해 주세요." });
  });

  it("파일이 없거나 형식이 다르면 고칠 수 있는 안내(4xx)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    expect((await post(new FormData())).status).toBe(400);
    const form = new FormData();
    form.set("file", new Blob([new TextEncoder().encode("not a document")]));
    form.set("kind", "policy");
    const response = await post(form);
    expect(response.status).toBe(415);
    expect((await response.json()).message).toContain("PDF, JPG, PNG, HEIC");
  });
});
