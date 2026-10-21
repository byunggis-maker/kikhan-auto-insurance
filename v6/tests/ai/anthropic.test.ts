import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
    const response = await route();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "unavailable", message: AI_UNAVAILABLE_MESSAGE });
  });

  it(".env.local·.env는 git이 무시하고, .env.example에는 값이 없다", () => {
    const ignored = execFileSync("git", ["check-ignore", ".env.local", ".env"], { encoding: "utf8" }).trim().split("\n");
    expect(ignored).toEqual([".env.local", ".env"]);
    const example = readFileSync(".env.example", "utf8");
    expect(example).toMatch(/^ANTHROPIC_API_KEY=$/m);
  });
});
