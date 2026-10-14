import { describe, expect, it } from "vitest";
import { canUse, type PaidView } from "@/lib/guard/paid-client";

// 화면이 유료 기능 버튼을 보여 줄지 정하는 규칙. 이용권이 없거나 끝났거나 그 기능의 횟수를 다 쓰면 이용권 안내를 보인다.
const status = { enabled: true, siteKey: "k", limit: 3, remaining: 2, ttlMinutes: 120, calls: { "policy-read": 3, stt: 5, extract: 5, explain: 10, tts: 10 } };
const now = Date.parse("2026-10-14T01:00:00Z");
const view = (ticket: PaidView["ticket"], enabled = true): PaidView => ({ loaded: true, status: { ...status, enabled }, ticket, notice: null });

describe("유료 기능 버튼", () => {
  it("이용권이 있고 시간이 남았고 그 기능의 횟수가 남았을 때만 쓸 수 있다", () => {
    const ticket = { token: "t", expiresAt: "2026-10-14T03:00:00Z", usedUp: ["policy-read" as const] };
    expect(canUse(view(ticket), "tts", now)).toBe(true);
    expect(canUse(view(ticket), "policy-read", now)).toBe(false);
    expect(canUse(view(null), "tts", now)).toBe(false);
    expect(canUse(view(ticket), "tts", Date.parse("2026-10-14T03:00:00Z"))).toBe(false);
    expect(canUse(view(ticket, false), "tts", now)).toBe(false);
  });
});
