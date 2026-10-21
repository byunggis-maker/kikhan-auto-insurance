import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { POST as readDocument } from "@/app/api/documents/read/route";
import { POST as speech } from "@/app/api/speech/route";
import { AI_UNAVAILABLE_MESSAGE, hasApiKey } from "@/lib/ai/anthropic";

// 라운드 6b 지시 4: 키는 환경변수(.env.local·Vercel)에만. 키가 없으면 그 기능만 "준비 중", 앱은 계속 동작.

describe("API 키 원칙", () => {
  it("키가 없거나 빈 값이면 쓸 수 없다고 본다", () => {
    expect(hasApiKey({})).toBe(false);
    expect(hasApiKey({ ANTHROPIC_API_KEY: "  " })).toBe(false);
    expect(hasApiKey({ ANTHROPIC_API_KEY: "x" })).toBe(true);
  });

  it.each([
    ["음성", speech],
    ["서류 인식", readDocument],
  ])("%s 라우트는 503과 '준비 중' 안내를 돌려준다(예외 없이)", async (_name, route) => {
    const response = await route(new Request("http://localhost/api", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "unavailable", message: AI_UNAVAILABLE_MESSAGE });
  });

  it("서버 음성이 꺼져 있으면(D-40) 키가 있어도 503 '준비 중'", async () => {
    const { SERVER_SPEECH_ENABLED } = await import("@/lib/ai/features");
    expect(SERVER_SPEECH_ENABLED).toBe(false);
    vi.stubEnv("OPENAI_API_KEY", "test-key-not-real");
    vi.stubEnv("STT_MODEL", "test-model");
    const form = new FormData();
    form.set("audio", new Blob([new Uint8Array(10)], { type: "audio/webm" }));
    const response = await speech(new Request("http://localhost/api/speech", { method: "POST", body: form }));
    expect(response.status).toBe(503);
    vi.unstubAllEnvs();
  });

  it(".env.local·.env는 git이 무시하고, .env.example에는 값이 없다", () => {
    const ignored = execFileSync("git", ["check-ignore", ".env.local", ".env"], { encoding: "utf8" }).trim().split("\n");
    expect(ignored).toEqual([".env.local", ".env"]);
    const example = readFileSync(".env.example", "utf8");
    expect(example).toMatch(/^ANTHROPIC_API_KEY=$/m);
  });
});
