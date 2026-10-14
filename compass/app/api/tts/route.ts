import { z } from "zod";
import { ApiError, failure, privateHeaders, sameOrigin } from "@/lib/guard/http";
import { paidGuard } from "@/lib/guard/paid";
import { MAX_TTS_TEXT, synthesize, ttsConfig } from "@/lib/speech/tts";

export const maxDuration = 60;

const inputSchema = z.object({ text: z.string().trim().min(1).max(MAX_TTS_TEXT) }).strict();

// 글을 음성(mp3)으로 바꿔 돌려준다. 유료 기능이라 문지기(paidGuard)를 거친다.
// 글과 음성은 저장하지 않고 로그에도 남기지 않는다. 화면은 이름·차량번호·증권번호를 뺀 글만 보낸다.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await paidGuard(request, ["service"]);
    const config = ttsConfig();
    const text = await request.text();
    if (text.length > MAX_TTS_TEXT * 4) throw new ApiError(413, "TOO_LARGE", "읽을 내용이 너무 깁니다.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(400, "INVALID_INPUT", "입력값을 확인해 주세요.");
    }
    const input = inputSchema.parse(body);
    const audio = await synthesize(input.text, config);
    return new Response(audio, { headers: { ...privateHeaders, "Content-Type": "audio/mpeg" } });
  } catch (error) {
    return failure(error);
  }
}
