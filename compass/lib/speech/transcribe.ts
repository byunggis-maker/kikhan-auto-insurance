import { ApiError } from "@/lib/guard/http";
import { postJson, type LlmErrors } from "@/lib/llm/structured";
import { maskResidentNumbers } from "@/lib/privacy/rrn";

// 음성을 글로 바꾼다(OpenAI 음성 전사 API). 음성은 요청 메모리에서만 다루고 저장하지 않는다.

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 5000;
const FAILED = "음성을 글로 바꾸지 못했습니다. 다시 시도하거나 아래에 직접 적어 주세요.";
const ERRORS: LlmErrors = { prefix: "STT", failed: FAILED, config: "음성 변환 설정(API 키·모델 이름)을 확인해 주세요." };

/** 브라우저가 녹음한 형식 → 제공자가 형식을 알아보는 파일 확장자 */
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

export type SttConfig = { key: string; model: string };

export function sttConfig(env: Record<string, string | undefined> = process.env): SttConfig {
  const key = env.OPENAI_API_KEY?.trim();
  const model = env.STT_MODEL?.trim();
  if (!key || !model) throw new ApiError(503, "STT_CONFIG", "음성 변환이 아직 설정되지 않았습니다. 지금은 아래에 직접 적어 주세요.");
  return { key, model };
}

export function audioExtension(mime: string): string | null {
  return EXTENSIONS[mime.split(";")[0].trim().toLowerCase()] ?? null;
}

export async function transcribe(audio: Blob, config: SttConfig): Promise<string> {
  if (audio.size === 0) throw new ApiError(400, "AUDIO_EMPTY", "녹음이 비어 있습니다. 다시 녹음해 주세요.");
  if (audio.size > MAX_AUDIO_BYTES) throw new ApiError(413, "AUDIO_TOO_LARGE", "녹음이 너무 깁니다. 5분 안쪽으로 나눠서 말해 주세요.");
  const extension = audioExtension(audio.type);
  if (!extension) throw new ApiError(415, "AUDIO_TYPE", "이 브라우저의 녹음 형식은 지원하지 않습니다. 아래에 직접 적어 주세요.");

  const form = new FormData();
  form.set("file", audio, `speech.${extension}`);
  form.set("model", config.model);
  form.set("language", "ko");
  form.set("response_format", "json");
  const data = (await postJson("https://api.openai.com/v1/audio/transcriptions", { Authorization: `Bearer ${config.key}` }, form, ERRORS)) as {
    text?: unknown;
  } | null;
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) throw new ApiError(422, "AUDIO_SILENT", "말소리를 알아듣지 못했습니다. 조금 더 또렷하게 다시 말해 주세요.");
  // 말하다가 주민등록번호를 불렀을 수도 있다. 뒷자리를 가린다.
  return maskResidentNumbers(text).slice(0, MAX_TEXT);
}
