import { describe, expect, it } from "vitest";
import { audioExtension, transcribeAudio } from "@/lib/ai/speech";

// 라운드 7 음성→문자(제공자 호출은 가짜). 바뀐 글의 개인정보는 가린다.

const audio = (type: string, size = 100) => new Blob([new Uint8Array(size)], { type });

describe("음성→문자", () => {
  it("브라우저 녹음 형식 → 확장자(크롬 webm, 사파리 mp4)", () => {
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtension("audio/mp4")).toBe("mp4");
    expect(audioExtension("audio/flac")).toBeNull();
  });

  it("바뀐 글의 전화번호·차량번호를 가린다", async () => {
    const text = await transcribeAudio(audio("audio/webm"), async () => " 뒤차 12가3456이 받았어요. 제 번호는 010-1234-5678입니다. ");
    expect(text).toBe("뒤차 ●●●●●●●이 받았어요. 제 번호는 ●●●-●●●●-●●●●입니다.");
  });

  it("빈 녹음·모르는 형식·말소리 없음은 고칠 수 있는 안내", async () => {
    await expect(transcribeAudio(audio("audio/webm", 0), async () => "x")).rejects.toMatchObject({ status: 400 });
    await expect(transcribeAudio(audio("audio/flac"), async () => "x")).rejects.toMatchObject({ status: 415 });
    await expect(transcribeAudio(audio("audio/mp4"), async () => "  ")).rejects.toMatchObject({ status: 422 });
  });
});
