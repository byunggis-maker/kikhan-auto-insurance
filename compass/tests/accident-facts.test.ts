import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as extractPost } from "@/app/api/extract/accident/route";
import { POST as sttPost } from "@/app/api/stt/route";
import { applyFacts } from "@/lib/draft/apply-facts";
import { ApiError } from "@/lib/guard/http";
import { newAccident, newDraft, newPerson } from "@/lib/draft/store";
import { daysFromText, extractFacts, toFacts, type FactsCall } from "@/lib/extract/accident";
import type { RawFacts } from "@/lib/schemas/accident-facts";
import { audioExtension } from "@/lib/speech/transcribe";

// 유료 기능 문지기, 음성 변환 제공자, LLM을 가짜로 바꿔 끼운다. 문지기 자체는 tests/paid-guard.test.ts가 확인한다. 실제 제공자의 인식 품질은 이 테스트가 확인하지 않는다.
const guard = vi.hoisted(() => ({ paidGuard: vi.fn() }));
vi.mock("@/lib/guard/paid", () => guard);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const SAID = "어제 오후 세 시쯤 시청 앞 사거리에서 신호 대기 중에 뒤차가 들이받았습니다. 저는 목을 다쳐서 경추 염좌 진단을 받고 2주 입원했고, 옆에 탄 아내는 허리가 아프다고 합니다. 저는 회사원이고 과실은 없습니다.";

const ANSWER: RawFacts = {
  accident: { date: "2026-10-12", time: "15:00", place: "시청 앞 사거리", kind: "car_car", vehicleDamage: "뒤 범퍼 파손", inferred: ["date", "kind"] },
  people: [
    {
      label: "본인",
      role: "driver",
      injury: "목을 다침",
      diagnosis: "경추 염좌",
      surgery: null,
      hospitalStay: "2주",
      outpatientVisits: null,
      faultPercent: 0,
      occupation: "회사원",
      inferred: ["role"],
    },
    {
      label: "아내",
      role: "passenger",
      injury: "허리가 아픔",
      diagnosis: null,
      surgery: null,
      hospitalStay: null,
      outpatientVisits: "5회",
      faultPercent: null,
      occupation: null,
      inferred: ["diagnosis", "surgery"],
    },
  ],
};

function fakeLlm(answers: unknown[] = [ANSWER]) {
  const requests: Parameters<FactsCall>[0][] = [];
  const call: FactsCall = async (request) => {
    requests.push(request);
    return answers[Math.min(requests.length, answers.length) - 1];
  };
  return { call, requests };
}

describe("기간 표현을 일수로 바꾸기(LLM이 아니라 코드가 한다)", () => {
  it("일·회는 그대로, 주는 7일로 바꾸고 추정으로 표시한다", () => {
    expect(daysFromText("3일")).toEqual({ days: 3, approximate: false });
    expect(daysFromText("0일")).toEqual({ days: 0, approximate: false });
    expect(daysFromText("5회")).toEqual({ days: 5, approximate: false });
    expect(daysFromText("2주")).toEqual({ days: 14, approximate: true });
    expect(daysFromText("약 3 주일 정도")).toEqual({ days: 21, approximate: true });
  });

  it("일수로 딱 떨어지지 않거나 알 수 없는 표현은 바꾸지 않는다", () => {
    for (const value of ["두 달", "2개월", "한동안", "", null, "9999주"]) expect(daysFromText(value)).toBeNull();
  });
});

describe("사고 사실 추출", () => {
  it("말한 내용을 정해진 칸으로 옮긴다", async () => {
    const llm = fakeLlm();
    const facts = await extractFacts(SAID, "2026-10-13", llm.call);
    expect(llm.requests[0].instructions).toContain("오늘은 2026-10-13");
    expect(facts.accident).toEqual({ date: "2026-10-12", time: "15:00", place: "시청 앞 사거리", kind: "car_car", vehicleDamage: "뒤 범퍼 파손", inferred: ["date", "kind"] });
    expect(facts.people[0]).toMatchObject({ label: "본인", role: "driver", diagnosis: "경추 염좌", hospitalDays: 14, faultPercent: 0, occupation: "회사원" });
    // "2주"를 14일로 바꾼 값은 추정으로 표시한다.
    expect(facts.people[0].inferred).toEqual(["role", "hospitalDays"]);
    expect(facts.people[1]).toMatchObject({ role: "passenger", diagnosis: null, outpatientDays: 5, faultPercent: null });
  });

  it("비어 있는 칸은 추정 목록에서 뺀다", async () => {
    const facts = await extractFacts(SAID, "2026-10-13", fakeLlm().call);
    // 아내의 진단명·수술은 null인데 LLM이 추정이라고 적었다. 값이 없으므로 표시하지 않는다.
    expect(facts.people[1].inferred).toEqual([]);
  });

  it("범위를 벗어난 과실비율, 틀린 날짜·시각은 버린다", () => {
    const facts = toFacts({
      accident: { ...ANSWER.accident, date: "2026-13-40", time: "25:00" },
      people: [{ ...ANSWER.people[0], faultPercent: 150 }],
    });
    expect(facts.accident).toMatchObject({ date: null, time: null, inferred: ["kind"] });
    expect(facts.people[0].faultPercent).toBeNull();
  });

  it("모양이 맞지 않으면 한 번만 다시 시키고, 또 틀리면 실패로 끝낸다", async () => {
    const retried = fakeLlm([{ people: "없음" }, ANSWER]);
    expect((await extractFacts(SAID, "2026-10-13", retried.call)).people).toHaveLength(2);
    expect(retried.requests).toHaveLength(2);
    expect(retried.requests[1].instructions).toContain("직전 응답");
    await expect(extractFacts(SAID, "2026-10-13", fakeLlm([null]).call)).rejects.toMatchObject({ status: 502, code: "EXTRACT_INVALID" });
  });

  it("주민등록번호가 섞여 있으면 LLM에 보내기 전에 가리고, 결과에서도 가린다", async () => {
    const llm = fakeLlm([{ ...ANSWER, accident: { ...ANSWER.accident, place: "주민번호 800505-1234567" } }]);
    const facts = await extractFacts(`${SAID} 제 주민번호는 800505-1234567입니다.`, "2026-10-13", llm.call);
    expect(llm.requests[0].text).not.toContain("1234567");
    expect(JSON.stringify(facts)).not.toContain("1234567");
  });
});

describe("뽑은 사실을 입력 초안에 옮기기", () => {
  it("사람 카드를 채우고 추정 표시를 남긴다", async () => {
    const facts = await extractFacts(SAID, "2026-10-13", fakeLlm().call);
    const before = { ...newDraft("a", "2026-10-13T00:00:00.000Z"), accident: { ...newAccident(), text: SAID } };
    let n = 0;
    const draft = applyFacts(before, facts, () => `p${++n}`);
    expect(draft.accident).toMatchObject({ date: "2026-10-12", time: "15:00", kind: "car_car", text: SAID, inferred: ["date", "kind"] });
    expect(draft.vehicle.damage).toBe("뒤 범퍼 파손");
    expect(draft.people).toHaveLength(2);
    expect(draft.people[0]).toMatchObject({ id: "p1", role: "driver", diagnosis: "경추 염좌", hospitalDays: 14, faultPercent: 0, inferred: ["role", "hospitalDays"] });
    // 말하지 않은 값은 0이 아니라 null(입력하지 않음)로 남는다. 급수와 소득은 추출하지 않는다.
    expect(draft.people[1]).toMatchObject({ hospitalDays: null, faultPercent: null, surgery: null, injuryGrade: null, monthlyIncome: null });
  });

  it("사람을 하나도 뽑지 못하면 적어 둔 사람 카드를 지우지 않는다", () => {
    const before = { ...newDraft("a", "2026-10-13T00:00:00.000Z"), people: [newPerson("keep", "driver")] };
    const draft = applyFacts(before, toFacts({ accident: { date: null, time: null, place: null, kind: null, vehicleDamage: null, inferred: [] }, people: [] }), () => "x");
    expect(draft.people.map((p) => p.id)).toEqual(["keep"]);
    expect(draft.accident.date).toBe("");
  });
});

function setup(options: { blocked?: boolean; keys?: boolean } = {}) {
  if (options.keys !== false) {
    vi.stubEnv("OPENAI_API_KEY", "test-openai");
    vi.stubEnv("STT_MODEL", "test-stt");
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("LLM_MODEL", "test-llm");
  }
  if (options.blocked) guard.paidGuard.mockRejectedValue(new ApiError(503, "PAID_UNAVAILABLE", "쓸 수 없음"));
  else guard.paidGuard.mockResolvedValue({ claims: {}, refund: vi.fn(async () => {}), sameFile: vi.fn(async () => false) });
  const provider = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) =>
    url.includes("/audio/transcriptions")
      ? Response.json({ text: " 어제 사고가 났습니다. 주민번호는 800505-1234567 " })
      : Response.json({ choices: [{ message: { content: JSON.stringify(ANSWER) } }] }),
  );
  vi.stubGlobal("fetch", provider);
  return provider;
}

function audioRequest(type = "audio/webm;codecs=opus", bytes = 2000) {
  const form = new FormData();
  form.set("audio", new File([new Uint8Array(bytes)], "speech", { type }));
  return new Request("http://localhost/api/stt", { method: "POST", body: form });
}
const textRequest = (text: string) =>
  new Request("http://localhost/api/extract/accident", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });

describe("/api/stt", () => {
  it("문지기가 막으면 제공자를 부르지 않는다. 건강정보 동의를 요구한다", async () => {
    const provider = setup({ blocked: true });
    const response = await sttPost(audioRequest());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("PAID_UNAVAILABLE");
    expect(provider).not.toHaveBeenCalled();
    expect(guard.paidGuard).toHaveBeenCalledWith(expect.any(Request), "stt", ["service", "health"]);
  });

  it("설정이 없거나 형식을 모르는 녹음이면 안내한다", async () => {
    setup({ keys: false });
    expect((await (await sttPost(audioRequest())).json()).code).toBe("STT_CONFIG");
    const provider = setup();
    expect((await sttPost(audioRequest("application/zip"))).status).toBe(415);
    expect(provider).not.toHaveBeenCalled();
  });

  it("녹음을 한국어로 바꿔 달라고 보내고, 받은 글에서 주민등록번호를 가린다", async () => {
    const provider = setup();
    const response = await sttPost(audioRequest("audio/mp4"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "어제 사고가 났습니다. 주민번호는 800505-******" });
    const [url, init] = provider.mock.calls[0];
    const form = init.body as FormData;
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-openai");
    expect(form.get("model")).toBe("test-stt");
    expect(form.get("language")).toBe("ko");
    expect((form.get("file") as File).name).toBe("speech.mp4");
  });

  it("브라우저마다 다른 녹음 형식을 알아본다", () => {
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtension("audio/mp4")).toBe("mp4");
    expect(audioExtension("audio/ogg; codecs=opus")).toBe("ogg");
    expect(audioExtension("text/plain")).toBeNull();
  });
});

describe("/api/extract/accident", () => {
  it("문지기가 막으면 제공자를 부르지 않는다. 건강정보 동의를 요구한다", async () => {
    const provider = setup({ blocked: true });
    expect((await extractPost(textRequest(SAID))).status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    expect(guard.paidGuard).toHaveBeenCalledWith(expect.any(Request), "extract", ["service", "health"]);
  });

  it("너무 짧은 글은 받지 않는다", async () => {
    const provider = setup();
    expect((await extractPost(textRequest("사고"))).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it("글을 보내 사실을 받아 돌려준다", async () => {
    const provider = setup();
    const response = await extractPost(textRequest(SAID));
    expect(response.status).toBe(200);
    const { facts } = await response.json();
    expect(facts.people).toHaveLength(2);
    expect(facts.people[0].hospitalDays).toBe(14);
    const body = JSON.parse(provider.mock.calls[0][1].body as string);
    expect(body.model).toBe("test-llm");
    expect(body.response_format.json_schema.name).toBe("record_accident");
    expect(body.messages[1].content[0].text).toContain("<statement>");
  });
});
