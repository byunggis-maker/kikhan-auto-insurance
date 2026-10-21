import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as readDocument } from "@/app/api/documents/read/route";
import { DAILY_AI_LIMIT, DAILY_LIMIT_MESSAGE, LimitError, clientIp, counted, resetDailyUses, seoulDay, takeDailyUse } from "@/lib/ai/limits";
import { MAX_PICK_BYTES, checkPicked } from "@/lib/ui/upload";

// 라운드 8 지시 1: 비용 보호. IP당 하루 20회(서류 인식·음성 합쳐), 한 건 10MB, 한 번에 5건.

beforeEach(() => resetDailyUses());

describe("IP당 하루 20회", () => {
  it("20회까지 쓰고 21번째는 막는다. 다른 IP는 따로 센다", () => {
    const now = new Date("2026-10-22T03:00:00Z");
    for (let i = 0; i < DAILY_AI_LIMIT; i++) expect(takeDailyUse("1.1.1.1", now)).toBe(true);
    expect(takeDailyUse("1.1.1.1", now)).toBe(false);
    expect(takeDailyUse("2.2.2.2", now)).toBe(true);
  });

  it("한국 시간 0시에 다시 센다", () => {
    expect(seoulDay(new Date("2026-10-22T14:59:59Z"))).toBe("2026-10-22");
    expect(seoulDay(new Date("2026-10-22T15:00:00Z"))).toBe("2026-10-23");
    const before = new Date("2026-10-22T14:59:00Z");
    for (let i = 0; i < DAILY_AI_LIMIT; i++) takeDailyUse("1.1.1.1", before);
    expect(takeDailyUse("1.1.1.1", before)).toBe(false);
    expect(takeDailyUse("1.1.1.1", new Date("2026-10-22T15:00:00Z"))).toBe(true);
  });

  it("IP는 x-forwarded-for의 첫 값", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "3.3.3.3, 10.0.0.1" } }))).toBe("3.3.3.3");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "4.4.4.4" } }))).toBe("4.4.4.4");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });

  it("제공자를 실제로 부를 때만 센다", async () => {
    const provider = vi.fn(async () => "ok");
    const call = counted("5.5.5.5", provider);
    for (let i = 0; i < DAILY_AI_LIMIT; i++) await call();
    await expect(call()).rejects.toBeInstanceOf(LimitError);
    expect(provider).toHaveBeenCalledTimes(DAILY_AI_LIMIT);
  });
});

describe("서류 인식 라우트", () => {
  afterEach(() => vi.unstubAllEnvs());

  const request = (ip: string, files = 1) => {
    const form = new FormData();
    // 첫 바이트가 서류 형식이 아니라 제공자를 부르기 전에 415로 끝나는 파일
    for (let i = 0; i < files; i++) form.append("file", new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    form.set("kind", "claim");
    form.set("target", "person");
    return new Request("http://localhost/api/documents/read", { method: "POST", body: form, headers: { "x-forwarded-for": ip } });
  };

  it("한도를 다 쓴 IP는 429와 안내 문구", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    for (let i = 0; i < DAILY_AI_LIMIT; i++) takeDailyUse("6.6.6.6");
    // 형식이 맞는 PDF라야 제공자를 부르는 단계까지 간다
    const form = new FormData();
    form.set("file", new Blob([new TextEncoder().encode("%PDF-1.4 test")], { type: "application/pdf" }));
    form.set("kind", "policy");
    const response = await readDocument(new Request("http://localhost/api/documents/read", { method: "POST", body: form, headers: { "x-forwarded-for": "6.6.6.6" } }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, reason: "limited", message: DAILY_LIMIT_MESSAGE });
  });

  it("입력 오류로 끝난 요청은 횟수를 쓰지 않는다", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    for (let i = 0; i < DAILY_AI_LIMIT + 5; i++) expect((await readDocument(request("7.7.7.7"))).status).toBe(415);
    expect(takeDailyUse("7.7.7.7")).toBe(true);
  });

  it("한 요청에 파일 두 건 이상은 400", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    expect((await readDocument(request("8.8.8.8", 2))).status).toBe(400);
  });

  it("키가 없으면 한도와 상관없이 503 '준비 중'(앱은 계속 동작)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await readDocument(request("9.9.9.9"))).status).toBe(503);
  });
});

describe("고르는 파일 한도", () => {
  const file = (size: number) => ({ size });
  it("5건·10MB까지는 통과", () => {
    expect(checkPicked([file(MAX_PICK_BYTES), file(1), file(1), file(1), file(1)])).toBeNull();
  });
  it("6건이면 나눠 올리라는 안내", () => {
    expect(checkPicked(Array.from({ length: 6 }, () => file(1)))).toMatch(/5건까지/);
  });
  it("10MB 넘는 파일이 있으면 안내", () => {
    expect(checkPicked([file(MAX_PICK_BYTES + 1)])).toMatch(/10MB/);
  });
});
