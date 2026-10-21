import { maskText } from "@/lib/privacy/mask";
import { InputError, ProviderError } from "./anthropic";

// MASTER.md 9장 음성→문자. V2(compass/lib/speech/transcribe.ts)와 같은 방식: OpenAI 음성 전사 API, 키 이름 OPENAI_API_KEY·STT_MODEL.
// 음성은 이 요청의 메모리에서만 다루고 저장하지 않는다. 바뀐 글은 개인정보를 가린 뒤 돌려준다.

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 5000;

/** 브라우저가 녹음한 형식 → 제공자가 알아보는 확장자(V2와 같음) */
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

export function audioExtension(mime: string): string | null {
  return EXTENSIONS[mime.split(";")[0].trim().toLowerCase()] ?? null;
}

export type Transcribe = (audio: Blob, extension: string) => Promise<string>;

export function openaiTranscribe(config: { key: string; model: string }): Transcribe {
  return async (audio, extension) => {
    const form = new FormData();
    form.set("file", audio, `speech.${extension}`);
    form.set("model", config.model);
    form.set("language", "ko");
    form.set("response_format", "json");
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.key}` },
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(55_000),
      });
    } catch {
      throw new ProviderError("network");
    }
    // 제공자 응답 원문은 오류 메시지·로그에 싣지 않는다
    if (!response.ok) throw new ProviderError(`status ${response.status}`);
    const data = (await response.json().catch(() => null)) as { text?: unknown } | null;
    return typeof data?.text === "string" ? data.text : "";
  };
}

export async function transcribeAudio(audio: Blob, transcribe: Transcribe): Promise<string> {
  if (audio.size === 0) throw new InputError(400, "녹음이 비어 있습니다. 다시 녹음해 주세요.");
  if (audio.size > MAX_AUDIO_BYTES) throw new InputError(413, "녹음이 너무 깁니다. 3분 안쪽으로 나눠서 말해 주세요.");
  const extension = audioExtension(audio.type);
  if (!extension) throw new InputError(415, "이 브라우저의 녹음 형식은 지원하지 않습니다. 직접 적어 주세요.");
  const text = (await transcribe(audio, extension)).trim();
  if (!text) throw new InputError(422, "말소리를 알아듣지 못했습니다. 조금 더 또렷하게 다시 말해 주세요.");
  // 말하다가 주민번호·전화번호·차량번호를 불렀을 수도 있다. 돌려주기 전에 가린다
  return maskText(text).slice(0, MAX_TEXT);
}
