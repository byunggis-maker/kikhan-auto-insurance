import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyReading } from "@/lib/draft/apply-reading";
import { newPolicy } from "@/lib/draft/store";
import { detectKind, prepareFile } from "@/lib/extract/file";
import { parseDateText } from "@/lib/extract/normalize";
import { providerCall, readPolicy, visionConfig, type VisionCall, type VisionRequest } from "@/lib/extract/vision";
import { policyReadingSchema, type RawReading } from "@/lib/schemas/policy-reading";

// tests/fixtures의 파일은 scripts/make-policy-fixtures.mjs로 만든 가짜 증권이다. 실제 개인정보가 아니다.
// 비전 LLM은 가짜로 바꿔 끼운다. 실제 제공자가 그림을 얼마나 잘 읽는지는 이 테스트가 확인하지 않는다.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** LLM이 샘플 증권을 제대로 읽었을 때의 응답. 지시를 어기고 주민등록번호를 적은 경우까지 넣었다. */
const ANSWER: RawReading = {
  insurer: "가상화재해상보험",
  productName: "가상 개인용 자동차보험",
  productLine: "personal",
  policyNumber: "가상-2026-000123",
  periodStart: "2026-01-01",
  periodEnd: "2027.01.01",
  policyholderName: "홍길동",
  insuredName: "홍길동 (800505-1234567)",
  residentFront6: "800505",
  residentBackFirst: "1",
  birthDateText: null,
  genderText: null,
  vehicleNumber: "12가3456",
  vehicleModel: "가상세단 2.0",
  driverScope: "부부한정",
  driverAgeLimit: "만 30세 이상",
  coverages: [
    { name: "대인배상Ⅰ", limit: "자배법 시행령에서 정한 금액", deductible: "" },
    { name: "자동차상해", limit: "사망·후유장애 2억원, 부상 3천만원", deductible: "" },
    { name: "자기차량손해", limit: "2,500만원", deductible: "손해액의 20% (최소 20만원, 최대 50만원)" },
    { name: "대물배상", limit: null, deductible: null },
  ],
  riders: ["긴급출동서비스 특약", "블랙박스 장착 할인 특약"],
};

function fakeVision(answers: unknown[] = [ANSWER]) {
  const requests: VisionRequest[] = [];
  const call: VisionCall = async (request) => {
    requests.push(request);
    return answers[Math.min(requests.length, answers.length) - 1];
  };
  return { call, requests };
}

async function isRealPicture(image: Buffer) {
  const meta = await sharp(image).metadata();
  const stats = await sharp(image).stats();
  // 빈 흰 종이가 아니라 글자가 그려져 있는지: 밝기가 고르지 않아야 한다.
  return meta.format === "jpeg" && (meta.width ?? 0) > 500 && stats.channels[0].stdev > 5;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("파일 형식 판별", () => {
  it("파일 이름이 아니라 내용으로 형식을 가린다", () => {
    expect(detectKind(fixture("policy-sample.pdf"))).toBe("pdf");
    expect(detectKind(fixture("policy-scan.pdf"))).toBe("pdf");
    expect(detectKind(fixture("policy-sample.jpg"))).toBe("jpeg");
    expect(detectKind(fixture("policy-sample.heic"))).toBe("heic");
    expect(detectKind(new TextEncoder().encode("그냥 글자"))).toBeNull();
  });

  it("읽을 수 없는 형식, 빈 파일, 너무 큰 파일은 안내와 함께 거절한다", async () => {
    await expect(prepareFile(new TextEncoder().encode("그냥 글자"))).rejects.toMatchObject({ status: 415, code: "FILE_TYPE" });
    await expect(prepareFile(new Uint8Array())).rejects.toMatchObject({ status: 400, code: "FILE_EMPTY" });
    await expect(prepareFile(new Uint8Array(4 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });
  });
});

describe("가짜 증권 샘플 읽기", () => {
  it("PDF: 글자를 뽑아 보내고, 주민등록번호 뒷자리는 LLM에 보내지 않는다", async () => {
    const prepared = await prepareFile(fixture("policy-sample.pdf"));
    expect(prepared.source).toBe("pdf-text");
    expect(prepared.images).toHaveLength(0);
    expect(prepared.text).toContain("가상화재해상보험");
    expect(prepared.text).toContain("자기차량손해");
    expect(prepared.text).toContain("800505-******");
    expect(prepared.text).not.toContain("1234567");

    // LLM이 생년월일·성별을 못 채워도 서버가 PDF 글자에서 직접 만든다.
    const vision = fakeVision([{ ...ANSWER, residentFront6: null, residentBackFirst: null, insuredName: "홍길동" }]);
    const reading = await readPolicy(prepared, vision.call);
    expect(vision.requests[0].text).not.toContain("1234567");
    expect(reading).toMatchObject({ birthDate: "1980-05-05", gender: "M", insurer: "가상화재해상보험", periodEnd: "2027-01-01" });
  });

  it("HEIC: JPEG로 바꿔 보낸다", async () => {
    const prepared = await prepareFile(fixture("policy-sample.heic"));
    expect(prepared.source).toBe("image");
    expect(prepared.text).toBeNull();
    expect(prepared.images).toHaveLength(1);
    expect(await isRealPicture(prepared.images[0])).toBe(true);
    const vision = fakeVision();
    const reading = await readPolicy(prepared, vision.call);
    expect(vision.requests[0].images).toHaveLength(1);
    expect(reading.coverages).toHaveLength(4);
  });

  it("JPG: 그대로 그림으로 보낸다", async () => {
    const prepared = await prepareFile(fixture("policy-sample.jpg"));
    expect(prepared.source).toBe("image");
    expect(await isRealPicture(prepared.images[0])).toBe(true);
    const reading = await readPolicy(prepared, fakeVision().call);
    expect(reading.insuredName).toBe("홍길동 (800505-******)");
  });

  it("글자가 없는 스캔 PDF: 쪽을 그림으로 바꿔 보낸다", async () => {
    const prepared = await prepareFile(fixture("policy-scan.pdf"));
    expect(prepared.source).toBe("pdf-scan");
    expect(prepared.text).toBeNull();
    expect(prepared.images).toHaveLength(1);
    expect(await isRealPicture(prepared.images[0])).toBe(true);
  });

  it("비밀번호가 걸린 PDF: 비밀번호를 묻고, 맞으면 읽는다", async () => {
    await expect(prepareFile(fixture("policy-locked.pdf"))).rejects.toMatchObject({ status: 422, code: "PDF_PASSWORD" });
    await expect(prepareFile(fixture("policy-locked.pdf"), { password: "000000" })).rejects.toMatchObject({ code: "PDF_PASSWORD_WRONG" });
    const prepared = await prepareFile(fixture("policy-locked.pdf"), { password: "800505" });
    expect(prepared.source).toBe("pdf-text");
    expect(prepared.text).toContain("가상화재해상보험");
  });

  it("세 형식 모두 같은 모양의 결과가 나오고, 어디에도 주민등록번호 뒷자리가 없다", async () => {
    for (const name of ["policy-sample.pdf", "policy-sample.heic", "policy-sample.jpg"]) {
      const reading = await readPolicy(await prepareFile(fixture(name)), fakeVision().call);
      expect(policyReadingSchema.safeParse(reading).success).toBe(true);
      expect(JSON.stringify(reading)).not.toContain("1234567");
      expect(reading).not.toHaveProperty("residentFront6");
      expect(reading).toMatchObject({ birthDate: "1980-05-05", gender: "M", productLine: "personal", policyNumber: "가상-2026-000123" });
      // 금액은 숫자로 바꾸지 않고 적힌 그대로 둔다.
      expect(reading.coverages[1]).toEqual({ name: "자동차상해", limit: "사망·후유장애 2억원, 부상 3천만원", deductible: "" });
      expect(reading.coverages[3]).toEqual({ name: "대물배상", limit: null, deductible: null });
    }
  });
});

describe("판독 결과 검증", () => {
  const image = { source: "image" as const, text: null, images: [Buffer.from("x")], resident: null };

  it("모양이 맞지 않으면 한 번만 다시 시킨다", async () => {
    const vision = fakeVision([{ insurer: 3 }, ANSWER]);
    const reading = await readPolicy(image, vision.call);
    expect(vision.requests).toHaveLength(2);
    expect(vision.requests[1].instructions).toContain("직전 응답");
    expect(reading.insurer).toBe("가상화재해상보험");
  });

  it("두 번 다 맞지 않으면 실패로 끝낸다", async () => {
    const vision = fakeVision([null, "글자"]);
    await expect(readPolicy(image, vision.call)).rejects.toMatchObject({ status: 502, code: "VISION_INVALID" });
    expect(vision.requests).toHaveLength(2);
  });

  it("LLM이 다른 칸에 주민등록번호를 적어도 가리고, 거기서 생년월일·성별을 뽑는다", async () => {
    const leaked = { ...ANSWER, residentFront6: null, residentBackFirst: null, insuredName: "홍길동", riders: ["주민번호 020304-4123456"] };
    const reading = await readPolicy(image, fakeVision([leaked]).call);
    expect(reading.riders).toEqual(["주민번호 020304-******"]);
    expect(reading).toMatchObject({ birthDate: "2002-03-04", gender: "F" });
  });

  it("주민등록번호가 없으면 따로 적힌 생년월일과 성별을 쓴다", async () => {
    const answer = { ...ANSWER, residentFront6: null, residentBackFirst: null, insuredName: "홍길동", birthDateText: "1980년 5월 5일", genderText: "여" };
    expect(await readPolicy(image, fakeVision([answer]).call)).toMatchObject({ birthDate: "1980-05-05", gender: "F" });
  });

  it("날짜가 아닌 값은 비워 둔다", () => {
    expect(parseDateText("2026.01.01 00:00")).toBe("2026-01-01");
    expect(parseDateText("2026-13-01")).toBeNull();
    expect(parseDateText("미정")).toBeNull();
    expect(parseDateText(null)).toBeNull();
  });
});

describe("비전 제공자 호출", () => {
  const request: VisionRequest = { instructions: "지시", text: null, images: [Buffer.from("그림")] };

  it("설정이 모자라면 부르지 않는다", () => {
    expect(() => visionConfig({})).toThrowError(expect.objectContaining({ status: 503, code: "VISION_CONFIG" }));
    expect(() => visionConfig({ VISION_PROVIDER: "openai", VISION_MODEL: "m" })).toThrowError(expect.objectContaining({ code: "VISION_CONFIG" }));
    expect(() => visionConfig({ VISION_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).toThrowError(expect.objectContaining({ code: "VISION_CONFIG" }));
    expect(visionConfig({ VISION_PROVIDER: "anthropic", VISION_MODEL: "m", ANTHROPIC_API_KEY: " k " })).toEqual({ provider: "anthropic", model: "m", key: "k" });
  });

  it("Anthropic: 그림과 스키마를 보내고 도구 입력을 받는다", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ content: [{ type: "tool_use", input: ANSWER }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await providerCall({ provider: "anthropic", model: "model-a", key: "key-a" })(request);
    expect(result).toEqual(ANSWER);
    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key-a");
    expect(body.model).toBe("model-a");
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_policy" });
    expect(body.tools[0].input_schema.properties.coverages.type).toBe("array");
    expect(body.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
  });

  it("OpenAI: 그림과 스키마를 보내고 JSON 글을 받는다", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ choices: [{ message: { content: JSON.stringify(ANSWER) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await providerCall({ provider: "openai", model: "model-o", key: "key-o" })({ ...request, text: "문서 글", images: [] });
    expect(result).toEqual(ANSWER);
    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-o");
    expect(body.response_format.json_schema).toMatchObject({ strict: true, schema: { additionalProperties: false } });
    expect(body.messages[1].content[0].text).toContain("<document>\n문서 글\n</document>");
  });

  it("제공자가 실패해도 응답 원문을 오류에 싣지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("비밀 내용이 든 오류", { status: 500 })));
    const error = await providerCall({ provider: "openai", model: "m", key: "k" })(request).catch((e: unknown) => e as { publicMessage: string });
    expect(error).toMatchObject({ status: 502, code: "VISION_FAILED" });
    expect((error as { publicMessage: string }).publicMessage).not.toContain("비밀");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(providerCall({ provider: "anthropic", model: "m", key: "k" })(request)).rejects.toMatchObject({ code: "VISION_CONFIG" });
  });
});

describe("읽은 값을 입력 초안에 옮기기", () => {
  it("읽은 값은 채우고, 읽지 못한 칸은 비워 둔 채 표시한다", async () => {
    const reading = await readPolicy(await prepareFile(fixture("policy-sample.jpg")), fakeVision([{ ...ANSWER, vehicleModel: null, productLine: null }]).call);
    let n = 0;
    const policy = applyReading(newPolicy(), reading, () => `id${++n}`);
    expect(policy).toMatchObject({ insurer: "가상화재해상보험", vehicleModel: "", productLine: "" });
    // 판독 결과에 신원 칸이 있어도 입력 초안으로 옮기지 않는다(v2).
    for (const key of ["policyNumber", "policyholderName", "insuredName", "birthDate", "gender", "vehicleNumber"]) expect(policy).not.toHaveProperty(key);
    expect(policy.unread).toEqual(["vehicleModel", "productLine"]);
    expect(policy.riders).toHaveLength(2);

    const joined = policy.coverages.filter((c) => c.joined);
    expect(joined.map((c) => c.name)).toEqual(["대인배상Ⅰ", "자동차상해", "자기차량손해", "대물배상"]);
    expect(joined[3]).toMatchObject({ limit: "", deductible: "", unread: ["limit", "deductible"] });
    expect(joined[0].unread).toBeUndefined();
    // 읽히지 않은 기본 담보는 미가입으로 남고, 읽힌 담보와 겹치지 않는다.
    expect(policy.coverages.filter((c) => !c.joined).map((c) => c.name)).toEqual(["대인배상Ⅱ", "자기신체사고", "무보험자동차에 의한 상해"]);
  });

  it("담보를 하나도 읽지 못하면 그 사실을 표시한다", () => {
    const empty = policyReadingSchema.parse({
      ...Object.fromEntries(Object.keys(policyReadingSchema.shape).map((key) => [key, null])),
      coverages: [],
      riders: [],
    });
    const policy = applyReading(newPolicy(), empty, () => "x");
    expect(policy.unread).toContain("coverages");
    expect(policy.coverages.every((c) => !c.joined)).toBe(true);
  });
});
