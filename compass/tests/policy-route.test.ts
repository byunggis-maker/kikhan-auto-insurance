import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/policies/read/route";
import { ApiError } from "@/lib/guard/http";

// 유료 기능 문지기와 비전 제공자를 가짜로 바꿔 /api/policies/read의 분기를 확인한다.
const guard = vi.hoisted(() => ({ paidGuard: vi.fn() }));
vi.mock("@/lib/guard/paid", () => guard);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ANSWER = {
  insurer: "가상화재해상보험",
  productName: null,
  productLine: "personal",
  policyNumber: "가상-2026-000123",
  periodStart: "2026-01-01",
  periodEnd: "2027-01-01",
  policyholderName: "홍길동",
  insuredName: "홍길동",
  residentFront6: "800505",
  residentBackFirst: "1",
  birthDateText: null,
  genderText: null,
  vehicleNumber: "12가3456",
  vehicleModel: null,
  driverScope: null,
  driverAgeLimit: null,
  coverages: [{ name: "자기차량손해", limit: "2,500만원 (주민 800505-1234567)", deductible: null }],
  riders: [],
};

function setup(options: { blocked?: boolean; vision?: boolean } = {}) {
  if (options.vision !== false) {
    vi.stubEnv("VISION_PROVIDER", "anthropic");
    vi.stubEnv("VISION_MODEL", "test-model");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  }
  if (options.blocked) guard.paidGuard.mockRejectedValue(new ApiError(503, "PAID_NOT_READY", "준비 중"));
  else guard.paidGuard.mockResolvedValue(undefined);
  const provider = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ content: [{ type: "tool_use", input: ANSWER }] }));
  vi.stubGlobal("fetch", provider);
  return provider;
}

function upload(name: string | null, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (name) form.set("file", new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name));
  return new Request("http://localhost/api/policies/read", { method: "POST", body: form, headers });
}

it("문지기가 막으면 제공자를 부르지 않는다. 서비스 이용 동의를 요구한다", async () => {
  const provider = setup({ blocked: true });
  const response = await POST(upload("policy-sample.jpg"));
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe("PAID_NOT_READY");
  expect(provider).not.toHaveBeenCalled();
  expect(guard.paidGuard).toHaveBeenCalledWith(expect.any(Request), ["service"]);
});

it("비전 설정이 없으면 직접 입력을 안내한다", async () => {
  setup({ vision: false });
  const response = await POST(upload("policy-sample.jpg"));
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe("VISION_CONFIG");
});

it("다른 사이트에서 온 요청과 파일 없는 요청은 받지 않는다", async () => {
  const provider = setup();
  expect((await POST(upload("policy-sample.jpg", { origin: "https://evil.example" }))).status).toBe(403);
  expect((await POST(upload(null))).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});

it.each(["policy-sample.pdf", "policy-sample.heic", "policy-sample.jpg", "policy-scan.pdf"])("%s를 올리면 판독 결과를 돌려준다", async (name) => {
  const provider = setup();
  const response = await POST(upload(name));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const text = await response.text();
  // 응답 어디에도 주민등록번호 뒷자리가 없다.
  expect(text).not.toContain("1234567");
  const body = JSON.parse(text);
  expect(body.source).toBe({ "policy-sample.pdf": "pdf-text", "policy-scan.pdf": "pdf-scan" }[name] ?? "image");
  expect(body.reading).toMatchObject({ insurer: "가상화재해상보험", birthDate: "1980-05-05", gender: "M", vehicleModel: null });
  expect(body.reading.coverages[0]).toEqual({ name: "자기차량손해", limit: "2,500만원 (주민 800505-******)", deductible: null });
  expect(provider).toHaveBeenCalledTimes(1);
  // PDF 글자를 보낼 때는 제공자에게도 뒷자리를 보내지 않는다.
  if (name === "policy-sample.pdf") expect(provider.mock.calls[0][1].body as string).not.toContain("1234567");
});
