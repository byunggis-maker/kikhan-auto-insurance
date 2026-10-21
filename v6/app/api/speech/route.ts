import { InputError, NO_STORE, invalidResponse, speechConfig, unavailableResponse } from "@/lib/ai/anthropic";
import { SERVER_SPEECH_ENABLED } from "@/lib/ai/features";
import { MAX_AUDIO_BYTES, openaiTranscribe, transcribeAudio } from "@/lib/ai/speech";

export const maxDuration = 60;

// MASTER.md 9장: 음성→문자 변환(POST, 본문 form "audio"). 기능이 꺼져 있거나(lib/ai/features.ts) 키가 없거나 제공자가 실패하면 503 "준비 중".
// 음성과 바뀐 글은 저장하지 않고 로그에도 남기지 않는다.
export async function POST(request: Request) {
  const config = speechConfig();
  if (!SERVER_SPEECH_ENABLED || !config) return unavailableResponse();
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 100_000) throw new InputError(413, "녹음이 너무 깁니다. 3분 안쪽으로 나눠서 말해 주세요.");
    const form = await request.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof Blob)) throw new InputError(400, "녹음을 받지 못했습니다. 다시 녹음해 주세요.");
    const text = await transcribeAudio(audio, openaiTranscribe(config));
    return Response.json({ ok: true, text }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof InputError) return invalidResponse(error.status, error.message);
    return unavailableResponse();
  }
}
