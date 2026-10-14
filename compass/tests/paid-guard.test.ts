import { describe, expect, it, vi } from "vitest";
import { readGuardConfig } from "@/lib/guard/config";
import { CONSENT_HEADER, TICKET_HEADER, checkPaid, guardStatus, issueTicket, koreanDay, type GuardDeps } from "@/lib/guard/paid";
import { MemoryStore, StoreError, UpstashStore, type QuotaStore } from "@/lib/guard/store";
import { signTicket, verifyTicket } from "@/lib/guard/token";
import { CONSENT_VERSIONS } from "@/lib/privacy/consent-versions";

// 이용권 발급과 문지기(paidGuard)의 거절 규칙. 모든 거절은 제공자를 부르기 전에 일어난다(tests/paid-routes.test.ts가 라우트로 확인).

const SECRET = "test-secret-0123456789-0123456789-abcdef";
const ENV = { GUARD_SECRET: SECRET, TURNSTILE_SITE_KEY: "site-key-x", TURNSTILE_SECRET_KEY: "turnstile-secret-x" };
const BOTH = `service:${CONSENT_VERSIONS.service},health:${CONSENT_VERSIONS.health}`;
const SERVICE = `service:${CONSENT_VERSIONS.service}`;

/** 2026-10-14 10:00 (한국 시각) */
const START = Date.parse("2026-10-14T01:00:00Z");

function setup(options: { turnstile?: "ok" | "rejected" | "down"; env?: Record<string, string> } = {}) {
  let now = START;
  const clock = () => now;
  const store = new MemoryStore(clock);
  const turnstile = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void url;
    void init;
    if (options.turnstile === "down") throw new Error("down");
    return Response.json({ success: options.turnstile !== "rejected" });
  });
  const deps: GuardDeps = { config: readGuardConfig({ ...ENV, ...options.env })!, store, clock, fetcher: turnstile as unknown as typeof fetch };
  return {
    deps,
    store,
    turnstile,
    advance: (ms: number) => (now += ms),
  };
}

let tokenSeq = 0;
function ticketRequest(consent = SERVICE, ip = "203.0.113.7") {
  return new Request("http://localhost/api/guard/ticket", { method: "POST", headers: { [CONSENT_HEADER]: consent, "x-real-ip": ip } });
}
async function issue(deps: GuardDeps, ip?: string) {
  return issueTicket(ticketRequest(SERVICE, ip), `turnstile-token-${++tokenSeq}`, deps);
}
function paidRequest(ticket: string | null, consent = BOTH) {
  const headers: Record<string, string> = { [CONSENT_HEADER]: consent };
  if (ticket) headers[TICKET_HEADER] = ticket;
  return new Request("http://localhost/api/policies/read", { method: "POST", headers });
}

describe("이용권 서명", () => {
  it("서명이 틀리거나 내용을 고치면 위조로 본다", () => {
    const claims = { jti: "abcdefghijklmnop1234", iat: 1000, exp: 2000, plan: "free" as const };
    const token = signTicket(claims, SECRET);
    expect(verifyTicket(token, SECRET, 1500)).toEqual({ ok: true, claims });
    expect(verifyTicket(token, "other-secret-0123456789-0123456789-abcdef", 1500)).toEqual({ ok: false, reason: "invalid" });
    const [prefix, , signature] = token.split(".");
    const tampered = `${prefix}.${Buffer.from(JSON.stringify({ ...claims, exp: 999999 })).toString("base64url")}.${signature}`;
    expect(verifyTicket(tampered, SECRET, 1500)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyTicket("kc2t1.abc", SECRET, 1500)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyTicket(null, SECRET, 1500)).toEqual({ ok: false, reason: "missing" });
    expect(verifyTicket(token, SECRET, 2000)).toEqual({ ok: false, reason: "expired" });
    // 발급 시각이 미래인 것
    expect(verifyTicket(signTicket({ ...claims, iat: 5000, exp: 9000 }, SECRET), SECRET, 1500)).toEqual({ ok: false, reason: "invalid" });
  });

  it("이용권에는 번호·발급·만료 시각만 있고 IP나 사람 정보가 없다", async () => {
    const { deps } = setup();
    const { ticket } = await issue(deps);
    const payload = JSON.parse(Buffer.from(ticket.split(".")[1], "base64url").toString("utf8"));
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "jti", "plan"]);
    expect(ticket).not.toContain("203.0.113.7");
  });
});

describe("이용권 발급", () => {
  it("IP당 하루 3장. 4번째는 Turnstile을 부르기 전에 거절하고, 다른 IP는 따로 센다", async () => {
    const { deps, turnstile } = setup();
    const issued = [await issue(deps), await issue(deps), await issue(deps)];
    expect(issued.map((t) => t.remaining)).toEqual([2, 1, 0]);
    expect(turnstile).toHaveBeenCalledTimes(3);
    await expect(issue(deps)).rejects.toMatchObject({ status: 429, code: "DAILY_LIMIT" });
    expect(turnstile).toHaveBeenCalledTimes(3);
    await expect(issue(deps, "198.51.100.9")).resolves.toMatchObject({ remaining: 2 });
  });

  it("한국 시각 자정이 지나면 다시 3장을 받는다", async () => {
    const { deps, advance } = setup();
    for (let i = 0; i < 3; i++) await issue(deps);
    await expect(issue(deps)).rejects.toMatchObject({ code: "DAILY_LIMIT" });
    // 한국 시각 23:59까지는 그대로 막힌다.
    advance(Date.parse("2026-10-14T14:59:00Z") - START);
    await expect(issue(deps)).rejects.toMatchObject({ code: "DAILY_LIMIT" });
    advance(2 * 60 * 1000); // 한국 시각 10월 15일 00:01
    expect(await guardStatus(ticketRequest(), deps)).toMatchObject({ enabled: true, remaining: 3, limit: 3 });
    await expect(issue(deps)).resolves.toMatchObject({ remaining: 2 });
  });

  it("한국 날짜는 UTC 15시에 바뀐다", () => {
    expect(koreanDay(Date.parse("2026-10-14T14:59:59Z"))).toBe("2026-10-14");
    expect(koreanDay(Date.parse("2026-10-14T15:00:00Z"))).toBe("2026-10-15");
  });

  it("같은 Turnstile 토큰을 다시 쓰면 거절한다", async () => {
    const { deps, turnstile } = setup();
    await issueTicket(ticketRequest(), "same-token", deps);
    await expect(issueTicket(ticketRequest(), "same-token", deps)).rejects.toMatchObject({ status: 400, code: "TURNSTILE_REUSED" });
    expect(turnstile).toHaveBeenCalledTimes(1);
  });

  it("Cloudflare 시험용 키는 같은 가짜 토큰을 주므로 재사용 검사를 건너뛰고, 실제 배포에서는 시험용 키를 받지 않는다", async () => {
    const test = setup({ env: { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" } });
    await issueTicket(ticketRequest(), "XXXX.DUMMY.TOKEN.XXXX", test.deps);
    await expect(issueTicket(ticketRequest(), "XXXX.DUMMY.TOKEN.XXXX", test.deps)).resolves.toMatchObject({ remaining: 1 });
    expect(readGuardConfig({ ...ENV, TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", VERCEL_ENV: "production" })).toBeNull();
    expect(readGuardConfig({ ...ENV, TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", VERCEL_ENV: "preview" })).not.toBeNull();
    expect(readGuardConfig({ ...ENV, VERCEL_ENV: "production" })).not.toBeNull();
  });

  it("Turnstile 실패·장애, 동의 없음은 이용권을 주지 않고 오늘 장수도 줄지 않는다", async () => {
    const rejected = setup({ turnstile: "rejected" });
    await expect(issue(rejected.deps)).rejects.toMatchObject({ status: 400, code: "TURNSTILE_FAILED" });
    expect(await guardStatus(ticketRequest(), rejected.deps)).toMatchObject({ remaining: 3 });
    const down = setup({ turnstile: "down" });
    await expect(issue(down.deps)).rejects.toMatchObject({ status: 503, code: "TURNSTILE_UNAVAILABLE" });
    const fine = setup();
    await expect(issueTicket(ticketRequest(""), "t", fine.deps)).rejects.toMatchObject({ status: 403, code: "CONSENT_REQUIRED" });
    await expect(issueTicket(ticketRequest("service:2020-01-01-old"), "t", fine.deps)).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(fine.turnstile).not.toHaveBeenCalled();
  });

  it("발급 시도를 시간당 20번 넘게 하면 막는다", async () => {
    const { deps } = setup({ turnstile: "rejected" });
    for (let i = 0; i < 20; i++) await expect(issue(deps)).rejects.toMatchObject({ code: "TURNSTILE_FAILED" });
    await expect(issue(deps)).rejects.toMatchObject({ status: 429, code: "TOO_MANY_TRIES" });
  });

  it("저장소에는 IP 원문이 없다", async () => {
    const { deps, store } = setup();
    await issue(deps);
    const keys = [...(store as unknown as { map: Map<string, unknown> }).map.keys()];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join(" ")).not.toContain("203.0.113.7");
  });

  it("설정이 없거나 하루 장수가 0이면 유료 기능을 막는다", async () => {
    expect(readGuardConfig({})).toBeNull();
    expect(readGuardConfig({ ...ENV, GUARD_SECRET: "short" })).toBeNull();
    expect(readGuardConfig({ ...ENV, DAILY_TICKET_LIMIT: "0" })?.dailyTickets).toBe(0);
    await expect(issueTicket(ticketRequest(), "t", null)).rejects.toMatchObject({ status: 503, code: "PAID_UNAVAILABLE" });
    await expect(checkPaid(paidRequest("x"), "tts", ["service"], null)).rejects.toMatchObject({ status: 503, code: "PAID_UNAVAILABLE" });
    expect(await guardStatus(ticketRequest(), null)).toMatchObject({ enabled: false, siteKey: null });
  });

  it("경로별 횟수와 유효 시간은 환경변수로 바꿀 수 있다", () => {
    const config = readGuardConfig({ ...ENV, TICKET_CALL_LIMITS: "policy-read=1, tts=20, nope=9, stt=abc", TICKET_TTL_MINUTES: "30", DAILY_TICKET_LIMIT: "5" })!;
    expect(config.calls).toEqual({ "policy-read": 1, stt: 5, extract: 5, explain: 10, tts: 20 });
    expect(config.ticketTtlSeconds).toBe(1800);
    expect(config.dailyTickets).toBe(5);
  });
});

describe("문지기(paidGuard)", () => {
  it("이용권 없음·위조·만료·발급 기록 없음은 거절한다", async () => {
    const { deps, advance } = setup();
    await expect(checkPaid(paidRequest(null), "policy-read", ["service"], deps)).rejects.toMatchObject({ status: 401, code: "TICKET_REQUIRED" });
    await expect(checkPaid(paidRequest("kc2t1.forged.sig"), "policy-read", ["service"], deps)).rejects.toMatchObject({ status: 401, code: "TICKET_INVALID" });
    // 서명은 맞지만 이 서버가 발급한 기록이 없는 이용권
    const nowSec = Math.floor(START / 1000);
    const unknown = signTicket({ jti: "made-up-ticket-number-01", iat: nowSec, exp: nowSec + 3600, plan: "free" }, SECRET);
    await expect(checkPaid(paidRequest(unknown), "policy-read", ["service"], deps)).rejects.toMatchObject({ status: 401, code: "TICKET_INVALID" });

    const { ticket } = await issue(deps);
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).resolves.toBeDefined();
    advance(2 * 60 * 60 * 1000);
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).rejects.toMatchObject({ status: 401, code: "TICKET_EXPIRED" });
  });

  it("동의 버전을 확인한다: 서비스 동의, 건강정보 경로는 건강정보 동의", async () => {
    const { deps } = setup();
    const { ticket } = await issue(deps);
    await expect(checkPaid(paidRequest(ticket, ""), "tts", ["service"], deps)).rejects.toMatchObject({ status: 403, code: "CONSENT_REQUIRED" });
    await expect(checkPaid(paidRequest(ticket, SERVICE), "stt", ["service", "health"], deps)).rejects.toMatchObject({ status: 403, code: "HEALTH_CONSENT_REQUIRED" });
    await expect(checkPaid(paidRequest(ticket, `${SERVICE},health:old-version`), "stt", ["service", "health"], deps)).rejects.toMatchObject({ code: "HEALTH_CONSENT_REQUIRED" });
    await expect(checkPaid(paidRequest(ticket, BOTH), "stt", ["service", "health"], deps)).resolves.toBeDefined();
  });

  it("이용권 1장으로 증권 읽기는 3번. 4번째는 거절하고, 다른 기능은 따로 센다", async () => {
    const { deps, advance } = setup();
    const { ticket } = await issue(deps);
    for (let i = 0; i < 3; i++) {
      await checkPaid(paidRequest(ticket), "policy-read", ["service"], deps);
      advance(3000);
    }
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).rejects.toMatchObject({ status: 429, code: "TICKET_USED_UP" });
    await expect(checkPaid(paidRequest(ticket), "tts", ["service"], deps)).resolves.toBeDefined();
  });

  it("같은 이용권으로 너무 빨리 다시 부르면 막는다", async () => {
    const { deps, advance } = setup();
    const { ticket } = await issue(deps);
    await checkPaid(paidRequest(ticket), "policy-read", ["service"], deps);
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).rejects.toMatchObject({ status: 429, code: "TOO_FAST" });
    advance(3000);
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).resolves.toBeDefined();
  });

  it("실패한 요청은 refund()로 횟수를 돌려받는다(여러 번 불러도 한 번)", async () => {
    const { deps, advance } = setup();
    const { ticket } = await issue(deps);
    for (let i = 0; i < 5; i++) {
      const pass = await checkPaid(paidRequest(ticket), "policy-read", ["service"], deps);
      await pass.refund();
      await pass.refund();
      advance(3000);
    }
    for (let i = 0; i < 3; i++) {
      await checkPaid(paidRequest(ticket), "policy-read", ["service"], deps);
      advance(3000);
    }
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).rejects.toMatchObject({ code: "TICKET_USED_UP" });
  });

  it("돌려받기를 되풀이해도 전체 시도 수(경로별 횟수 합의 2배)를 넘을 수 없다", async () => {
    const { deps, advance } = setup({ env: { TICKET_CALL_LIMITS: "policy-read=1,stt=0,extract=0,explain=0,tts=0" } });
    const { ticket } = await issue(deps);
    for (let i = 0; i < 2; i++) {
      await (await checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).refund();
      advance(3000);
    }
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).rejects.toMatchObject({ code: "TICKET_USED_UP" });
  });

  it("같은 파일을 다시 읽으면 2번까지 횟수를 깎지 않는다", async () => {
    const { deps, advance } = setup();
    const { ticket } = await issue(deps);
    const file = new Uint8Array([1, 2, 3, 4]);
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const pass = await checkPaid(paidRequest(ticket), "policy-read", ["service"], deps);
      results.push(await pass.sameFile(file));
      advance(3000);
    }
    // 처음 1번 + 무료 다시 읽기 2번 + 깎는 다시 읽기 1번 = 2번 쓴 것으로 센다.
    expect(results).toEqual([false, true, true, false]);
    await checkPaid(paidRequest(ticket), "policy-read", ["service"], deps);
    advance(3000);
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], deps)).rejects.toMatchObject({ code: "TICKET_USED_UP" });
  });

  it("저장소 장애는 사용자에게 알기 쉬운 503으로 바뀐다", async () => {
    const { deps } = setup();
    const { ticket } = await issue(deps);
    const broken: QuotaStore = {
      incr: async () => {
        throw new StoreError("x");
      },
      decr: async () => {},
      get: async () => 0,
      setOnce: async () => true,
      exists: async () => {
        throw new StoreError("x");
      },
    };
    await expect(checkPaid(paidRequest(ticket), "policy-read", ["service"], { ...deps, store: broken })).rejects.toMatchObject({ status: 503, code: "PAID_UNAVAILABLE" });
    await expect(issue({ ...deps, store: broken })).rejects.toMatchObject({ status: 503, code: "PAID_UNAVAILABLE" });
  });
});

describe("Upstash 저장소", () => {
  it("REST /pipeline으로 명령을 보낸다", async () => {
    const calls: unknown[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const commands = JSON.parse(String(init?.body)) as unknown[][];
      calls.push({ url, auth: (init?.headers as Record<string, string>).Authorization, commands });
      return Response.json(commands.map((command) => ({ result: command[0] === "INCR" ? 4 : command[0] === "SET" ? "OK" : command[0] === "EXISTS" ? 1 : command[0] === "GET" ? "2" : 1 })));
    });
    const store = new UpstashStore("https://example.upstash.io/", "token-x", fetcher as unknown as typeof fetch);
    expect(await store.incr("k", 60)).toBe(4);
    expect(await store.setOnce("s", 3000)).toBe(true);
    expect(await store.exists("e")).toBe(true);
    expect(await store.get("g")).toBe(2);
    expect(calls[0]).toEqual({ url: "https://example.upstash.io/pipeline", auth: "Bearer token-x", commands: [["INCR", "k"], ["EXPIRE", "k", 60, "NX"]] });
    expect((calls[1] as { commands: unknown }).commands).toEqual([["SET", "s", "1", "NX", "PX", 3000]]);
  });

  it("연결 실패·오류 응답은 StoreError", async () => {
    const down = new UpstashStore("https://example.upstash.io", "t", (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch);
    await expect(down.get("k")).rejects.toBeInstanceOf(StoreError);
    const bad = new UpstashStore("https://example.upstash.io", "t", (async () => Response.json([{ error: "WRONGTYPE" }])) as unknown as typeof fetch);
    await expect(bad.incr("k", 1)).rejects.toBeInstanceOf(StoreError);
    const status = new UpstashStore("https://example.upstash.io", "t", (async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
    await expect(status.exists("k")).rejects.toBeInstanceOf(StoreError);
  });
});

describe("간이 모드(Turnstile·Upstash 없음)", () => {
  const LITE = { GUARD_SECRET: SECRET };

  it("Turnstile 키가 없으면 봇 확인 없이 이용권을 주고, 키를 넣으면 다시 확인한다", async () => {
    const lite = setup();
    lite.deps.config = readGuardConfig(LITE)!;
    expect(lite.deps.config.turnstile).toBeNull();
    expect(await guardStatus(ticketRequest(), lite.deps)).toMatchObject({ enabled: true, siteKey: null });
    await expect(issueTicket(ticketRequest(), "", lite.deps)).resolves.toMatchObject({ remaining: 2 });
    expect(lite.turnstile).not.toHaveBeenCalled();
    // 키가 있으면 빈 토큰으로는 받지 못한다.
    const full = setup({ turnstile: "rejected" });
    await expect(issueTicket(ticketRequest(), "", full.deps)).rejects.toMatchObject({ code: "TURNSTILE_FAILED" });
  });

  it("배포에서 Upstash가 없으면 메모리로 돌며, IP당 하루 30회까지만 통과한다", async () => {
    const lite = setup();
    const deps: GuardDeps = { ...lite.deps, config: { ...readGuardConfig(LITE)!, calls: { "policy-read": 100, stt: 100, extract: 100, explain: 100, tts: 100 } }, fallback: true };
    const { ticket } = await issueTicket(ticketRequest(), "", deps);
    for (let i = 0; i < 30; i++) {
      lite.advance(5000);
      await checkPaid(paidRequest(ticket), "stt", ["service", "health"], deps);
    }
    lite.advance(5000);
    await expect(checkPaid(paidRequest(ticket), "stt", ["service", "health"], deps)).rejects.toMatchObject({ status: 429, code: "DAILY_LIMIT" });
    // 다음 날(한국 시각 자정 뒤)에는 다시 쓴다.
    lite.advance(24 * 60 * 60 * 1000);
    const next = await issueTicket(ticketRequest(), "", deps);
    await expect(checkPaid(paidRequest(next.ticket), "stt", ["service", "health"], deps)).resolves.toBeTruthy();
  });

  it("간이 모드에서는 다른 인스턴스가 발급한 이용권도 서명·만료가 맞으면 받는다", async () => {
    const lite = setup();
    const now = Math.floor(START / 1000);
    const elsewhere = signTicket({ jti: "issued-on-another-instance", iat: now, exp: now + 600, plan: "free" }, SECRET);
    await expect(checkPaid(paidRequest(elsewhere), "stt", ["service", "health"], { ...lite.deps, fallback: true })).resolves.toBeTruthy();
    await expect(checkPaid(paidRequest(elsewhere), "stt", ["service", "health"], lite.deps)).rejects.toMatchObject({ code: "TICKET_INVALID" });
  });
});
