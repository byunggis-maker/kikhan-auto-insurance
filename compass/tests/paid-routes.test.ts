import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAID_ROUTES, PAID_ROUTE_IDS, type PaidRoute } from "@/lib/guard/config";
import { CONSENT_HEADER, TICKET_HEADER, issueTicket } from "@/lib/guard/paid";
import { signTicket } from "@/lib/guard/token";
import { CONSENT_VERSIONS } from "@/lib/privacy/consent-versions";

// 유료 API를 부르는 모든 라우트가 맨 앞에서 문지기(paidGuard)를 거치는지 확인한다.
// 새 라우트를 만들고 문지기를 빠뜨리면 이 파일의 테스트가 실패한다.

const ROOT = join(import.meta.dirname, "..");
const API = join(ROOT, "app", "api");

/** 제공자를 부르지 않는 라우트. 여기에 넣으려면 그 라우트가 유료 제공자 모듈을 쓰지 않아야 한다(아래 테스트). */
const PUBLIC_ROUTES = ["/api/guard/config", "/api/guard/ticket", "/api/laws", "/api/laws/precedents"];

/** 유료 제공자(OpenAI·Anthropic)를 부르는 모듈. 이 모듈을 쓰는 라우트는 유료 라우트여야 한다. */
const PROVIDER_MODULES = ["@/lib/extract/vision", "@/lib/extract/accident", "@/lib/speech/transcribe", "@/lib/speech/tts", "@/lib/explain/llm", "@/lib/llm/structured"];
/** 제공자를 실제로 부르는 함수 이름. 라우트 안에서 문지기보다 먼저 나오면 안 된다. */
const PROVIDER_CALLS = ["readPolicy(", "transcribe(", "synthesize(", "extractFacts(", "explainCell("];

function routeFiles(dir = API): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}
const routePath = (file: string) => `/${relative(join(ROOT, "app"), file).replace(/\/route\.ts$/, "")}`;
const routes = routeFiles().map((file) => ({ file, path: routePath(file), source: readFileSync(file, "utf8") }));

describe("유료 라우트 목록", () => {
  it("모든 라우트는 공개 라우트이거나 유료 라우트 목록에 있다", () => {
    const paidPaths = Object.values(PAID_ROUTES).map((route) => route.path as string);
    expect(routes.length).toBeGreaterThanOrEqual(9);
    expect(routes.map((route) => route.path).filter((path) => !PUBLIC_ROUTES.includes(path) && !paidPaths.includes(path))).toEqual([]);
    for (const path of paidPaths) expect(routes.map((route) => route.path)).toContain(path);
  });

  it("유료 라우트마다 자기 경로 id로 paidGuard를 부르고, 제공자 호출보다 먼저 부른다", () => {
    for (const id of PAID_ROUTE_IDS) {
      const route = routes.find((candidate) => candidate.path === PAID_ROUTES[id].path)!;
      const calls = [...route.source.matchAll(/paidGuard\(request, "([a-z-]+)"/g)].map((match) => match[1]);
      expect(calls, route.path).toEqual([id]);
      const guardAt = route.source.indexOf("paidGuard(request");
      const handlerAt = route.source.indexOf("export async function POST");
      expect(guardAt, route.path).toBeGreaterThan(handlerAt);
      for (const call of PROVIDER_CALLS) {
        const at = route.source.indexOf(call);
        if (at >= 0) expect(at, `${route.path} ${call}`).toBeGreaterThan(guardAt);
      }
      // 내보내는 처리 함수는 POST 하나뿐이다(문지기를 거치지 않는 GET을 만들지 않는다).
      expect(route.source.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g), route.path).toEqual(["export async function POST"]);
    }
  });

  it("공개 라우트는 유료 제공자 모듈을 쓰지 않는다", () => {
    for (const route of routes.filter((candidate) => PUBLIC_ROUTES.includes(candidate.path))) {
      for (const name of PROVIDER_MODULES) expect(route.source, route.path).not.toContain(`"${name}"`);
    }
  });

  it("서버 코드에 console 출력이 없다(사고 내용·건강정보·증권 내용을 로그에 남기지 않는다)", () => {
    const dirs = ["app/api", "lib/guard", "lib/extract", "lib/speech", "lib/explain", "lib/llm", "lib/privacy", "lib/law"];
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir)).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(join(ROOT, path)).isDirectory()) return walk(path);
        return /\.tsx?$/.test(name) ? [path] : [];
      });
    const files = dirs.flatMap(walk);
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((file) => /\bconsole\.\w+\(/.test(readFileSync(join(ROOT, file), "utf8")))).toEqual([]);
  });
});

// ---- 실제 라우트를 불러 거절이 제공자 호출 전에 일어나는지 본다 ----

const SECRET = "route-secret-0123456789-0123456789-abcdef";
const BOTH = `service:${CONSENT_VERSIONS.service},health:${CONSENT_VERSIONS.health}`;
const SERVICE = `service:${CONSENT_VERSIONS.service}`;
/** 로그에 나오면 안 되는 가상 값 */
const SECRET_TEXT = "가상환자 경추염좌 전치3주 800505-1234567";

const needsHealth: Record<PaidRoute, boolean> = { "policy-read": false, stt: true, extract: true, explain: true, tts: false };

async function load(id: PaidRoute): Promise<(request: Request) => Promise<Response>> {
  const modules = {
    "policy-read": () => import("@/app/api/policies/read/route"),
    stt: () => import("@/app/api/stt/route"),
    extract: () => import("@/app/api/extract/accident/route"),
    explain: () => import("@/app/api/explain/route"),
    tts: () => import("@/app/api/tts/route"),
  };
  return (await modules[id]()).POST;
}

function body(id: PaidRoute): BodyInit {
  if (id === "policy-read") {
    const form = new FormData();
    form.set("file", new File([readFileSync(join(ROOT, "tests/fixtures/policy-sample.jpg"))], "policy.jpg"));
    return form;
  }
  if (id === "stt") {
    const form = new FormData();
    form.set("audio", new File([new Uint8Array(2000)], "speech", { type: "audio/webm" }));
    return form;
  }
  if (id === "explain") return JSON.stringify({ claim: { note: SECRET_TEXT }, rowId: "r", columnId: "c" });
  return JSON.stringify({ text: SECRET_TEXT });
}

function request(id: PaidRoute, headers: Record<string, string>) {
  const isJson = id === "extract" || id === "explain" || id === "tts";
  return new Request(`http://localhost${PAID_ROUTES[id].path}`, { method: "POST", body: body(id), headers: { ...(isJson ? { "Content-Type": "application/json" } : {}), ...headers } });
}

let provider: ReturnType<typeof vi.fn>;
let logs: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  vi.stubEnv("GUARD_SECRET", SECRET);
  vi.stubEnv("TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("OPENAI_API_KEY", "test-openai");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic");
  vi.stubEnv("STT_MODEL", "m");
  vi.stubEnv("TTS_MODEL", "m");
  vi.stubEnv("TTS_VOICE", "v");
  vi.stubEnv("VISION_PROVIDER", "anthropic");
  vi.stubEnv("VISION_MODEL", "m");
  vi.stubEnv("LLM_PROVIDER", "openai");
  vi.stubEnv("LLM_MODEL", "m");
  // Turnstile 확인만 통과시키고, 제공자 호출은 세기만 한다(실패 응답).
  provider = vi.fn(async (url: string | URL | Request) =>
    String(url).includes("challenges.cloudflare.com") ? Response.json({ success: true }) : new Response(`provider failed ${SECRET_TEXT}`, { status: 500 }),
  );
  vi.stubGlobal("fetch", provider);
  logs = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});

afterEach(() => {
  // 어떤 경우에도(거절·제공자 실패) 콘솔에 아무것도 남기지 않는다.
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const providerCalls = () => provider.mock.calls.filter(([url]) => !String(url).includes("challenges.cloudflare.com")).length;
let seq = 0;
async function freshTicket(ip = `192.0.2.${++seq}`) {
  return (await issueTicket(new Request("http://localhost/api/guard/ticket", { method: "POST", headers: { [CONSENT_HEADER]: SERVICE, "x-real-ip": ip } }), `token-${seq}-${Math.random()}`)).ticket;
}

describe.each(PAID_ROUTE_IDS)("%s 라우트", (id) => {
  it("이용권 없음·위조·만료면 제공자를 부르기 전에 401", async () => {
    const POST = await load(id);
    const now = Math.floor(Date.now() / 1000);
    const cases: [Record<string, string>, string][] = [
      [{ [CONSENT_HEADER]: BOTH }, "TICKET_REQUIRED"],
      [{ [CONSENT_HEADER]: BOTH, [TICKET_HEADER]: "kc2t1.eyJqdGkiOiJ4In0.forged" }, "TICKET_INVALID"],
      [{ [CONSENT_HEADER]: BOTH, [TICKET_HEADER]: signTicket({ jti: "never-issued-ticket-01", iat: now, exp: now + 600, plan: "free" }, SECRET) }, "TICKET_INVALID"],
      [{ [CONSENT_HEADER]: BOTH, [TICKET_HEADER]: signTicket({ jti: "expired-ticket-number-01", iat: now - 9000, exp: now - 10, plan: "free" }, SECRET) }, "TICKET_EXPIRED"],
    ];
    for (const [headers, code] of cases) {
      const response = await POST(request(id, headers));
      expect(response.status, code).toBe(401);
      const answer = await response.json();
      expect(answer.code).toBe(code);
      expect(answer.error).toMatch(/이용권/);
    }
    expect(providerCalls()).toBe(0);
  });

  it("동의가 없으면 제공자를 부르기 전에 403", async () => {
    const POST = await load(id);
    const ticket = await freshTicket();
    const response = await POST(request(id, { [CONSENT_HEADER]: needsHealth[id] ? SERVICE : "", [TICKET_HEADER]: ticket }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(needsHealth[id] ? "HEALTH_CONSENT_REQUIRED" : "CONSENT_REQUIRED");
    expect(providerCalls()).toBe(0);
  });

  it("이용권 횟수를 다 쓰면 제공자를 부르기 전에 429", async () => {
    vi.stubEnv("TICKET_CALL_LIMITS", `${id}=0`);
    const POST = await load(id);
    const ticket = await freshTicket();
    const response = await POST(request(id, { [CONSENT_HEADER]: BOTH, [TICKET_HEADER]: ticket }));
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe("TICKET_USED_UP");
    expect(providerCalls()).toBe(0);
  });

  it("문지기를 통과해도 제공자가 실패하면 한국어로 안내하고, 제공자 응답 원문과 입력을 싣지 않는다", async () => {
    const POST = await load(id);
    const ticket = await freshTicket();
    const response = await POST(request(id, { [CONSENT_HEADER]: BOTH, [TICKET_HEADER]: ticket }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    const text = await response.text();
    expect(text).not.toContain("provider failed");
    expect(text).not.toContain("800505");
    expect(JSON.parse(text).error).toMatch(/[가-힣]/);
  });
});

it("유료 기능 설정이 없으면(배포에서 저장소 없음) 503으로 막고 직접 입력을 안내한다", async () => {
  vi.stubEnv("VERCEL", "1");
  for (const id of PAID_ROUTE_IDS) {
    const response = await (await load(id))(request(id, { [CONSENT_HEADER]: BOTH }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PAID_UNAVAILABLE", error: expect.stringContaining("직접 입력") });
  }
  expect(providerCalls()).toBe(0);
});

it("이용권이 있으면 제공자를 부르고, 제공자가 실패하면 쓴 횟수를 돌려준다", async () => {
  vi.stubEnv("TICKET_CALL_LIMITS", "tts=1");
  const POST = await load("tts");
  const ticket = await freshTicket();
  const headers = { [CONSENT_HEADER]: SERVICE, [TICKET_HEADER]: ticket };
  const failed = await POST(request("tts", headers));
  expect(failed.status).toBeGreaterThanOrEqual(500);
  expect(providerCalls()).toBe(1);
  // 실패한 1회는 돌려받았으므로 같은 이용권으로 한 번 더 부를 수 있다(1초 간격 뒤).
  await new Promise((resolve) => setTimeout(resolve, 1100));
  provider.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } }));
  const ok = await POST(request("tts", headers));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("Content-Type")).toBe("audio/mpeg");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const used = await POST(request("tts", headers));
  expect(used.status).toBe(429);
  expect((await used.json()).code).toBe("TICKET_USED_UP");
});
