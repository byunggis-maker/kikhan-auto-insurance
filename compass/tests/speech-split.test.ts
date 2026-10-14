import { describe, expect, it } from "vitest";
import { encodeWav, needsSplit, SEND_LIMIT, sliceToWav } from "@/lib/speech/split";
import { detectInApp, externalOpenUrl } from "@/lib/browser/in-app";

describe("긴 녹음 나누기", () => {
  it("4MB 이하의 아는 형식은 그대로 보내고, 크거나 모르는 형식은 나눈다", () => {
    expect(needsSplit(new Blob([new Uint8Array(10)], { type: "audio/mp4" }))).toBe(false);
    expect(needsSplit(new Blob([new Uint8Array(10)], { type: "audio/webm;codecs=opus" }))).toBe(false);
    expect(needsSplit(new Blob([new Uint8Array(SEND_LIMIT + 1)], { type: "audio/mp4" }))).toBe(true);
    expect(needsSplit(new Blob([new Uint8Array(10)], { type: "" }))).toBe(true);
  });

  it("60초씩 잘라 WAV 조각을 만들고, 조각 하나는 4MB보다 작다", () => {
    const rate = 16000;
    const samples = new Float32Array(rate * 150); // 2분 30초
    const pieces = sliceToWav(samples, rate);
    expect(pieces).toHaveLength(3);
    expect(pieces[0].size).toBe(44 + rate * 60 * 2);
    expect(pieces[2].size).toBe(44 + rate * 30 * 2);
    expect(pieces.every((piece) => piece.size < SEND_LIMIT && piece.type === "audio/wav")).toBe(true);
  });

  it("WAV 머리말이 맞다", async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    const view = new DataView(await wav.arrayBuffer());
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
  });
});

describe("인앱 브라우저", () => {
  const kakao = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0";
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const instaAndroid = "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 350.0";
  const href = "https://example.vercel.app/cases/abc/accident?x=1";

  it("카카오톡은 openExternal 주소로 연다", () => {
    expect(detectInApp(kakao)).toEqual({ name: "카카오톡", kakao: true });
    expect(externalOpenUrl(kakao, href)).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`);
  });

  it("Safari는 인앱 브라우저가 아니다", () => {
    expect(detectInApp(safari)).toBeNull();
    expect(externalOpenUrl(safari, href)).toBeNull();
  });

  it("안드로이드의 다른 앱은 크롬 intent 주소로 연다", () => {
    expect(detectInApp(instaAndroid)?.name).toBe("인스타그램");
    expect(externalOpenUrl(instaAndroid, href)).toBe("intent://example.vercel.app/cases/abc/accident?x=1#Intent;scheme=https;package=com.android.chrome;end");
  });
});
