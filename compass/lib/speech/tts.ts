import { ApiError } from "@/lib/guard/http";
import { redact } from "@/lib/privacy/redact";

// 글을 음성으로 바꾼다(OpenAI 음성 합성 API). 글과 음성은 저장하지 않고 로그에도 남기지 않는다.

/** 한 번에 보내는 글자 수. 제공자의 한도보다 작게 잡는다. 화면이 이 길이로 나눠 보낸다 */
export const MAX_TTS_TEXT = 1500;
const FAILED = "읽어주기에 실패했습니다. 잠시 후 다시 눌러 주세요.";

export type TtsConfig = { key: string; model: string; voice: string };

export function ttsConfig(env: Record<string, string | undefined> = process.env): TtsConfig {
  const key = env.OPENAI_API_KEY?.trim();
  const model = env.TTS_MODEL?.trim();
  const voice = env.TTS_VOICE?.trim();
  if (!key || !model || !voice) throw new ApiError(503, "TTS_CONFIG", "읽어주기가 아직 설정되지 않았습니다.");
  return { key, model, voice };
}

/** mp3 음성을 돌려준다. 제공자의 응답 원문은 오류에 싣지 않는다 */
export async function synthesize(text: string, config: TtsConfig, send: typeof fetch = fetch): Promise<ArrayBuffer> {
  // 보내기 전에 한 번 더 가린다(화면은 신원정보를 뺀 글만 보낸다).
  const input = redact(text).text.trim();
  if (!input) throw new ApiError(400, "INVALID_INPUT", "읽을 내용이 없습니다.");
  if (input.length > MAX_TTS_TEXT) throw new ApiError(413, "TOO_LARGE", "읽을 내용이 너무 깁니다.");
  let response: Response;
  try {
    response = await send("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, voice: config.voice, input, response_format: "mp3" }),
      cache: "no-store",
      signal: AbortSignal.timeout(50000),
    });
  } catch {
    throw new ApiError(502, "TTS_FAILED", FAILED);
  }
  if (!response.ok) {
    const config = response.status === 401 || response.status === 403 || response.status === 404;
    throw new ApiError(502, config ? "TTS_CONFIG" : "TTS_FAILED", config ? "읽어주기 설정(API 키·모델·목소리 이름)을 확인해 주세요." : FAILED);
  }
  return response.arrayBuffer();
}
