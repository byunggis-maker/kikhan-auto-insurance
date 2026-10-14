import { ApiError, failure, privateHeaders, sameOrigin } from "@/lib/guard/http";
import { paidGuard, type PaidPass } from "@/lib/guard/paid";
import { MAX_AUDIO_BYTES, sttConfig, transcribe } from "@/lib/speech/transcribe";

export const maxDuration = 60;

// 녹음을 글로 바꿔 돌려준다. 다친 내용을 말하게 되므로 건강정보 동의가 있어야 한다.
// 음성과 바뀐 글은 저장하지 않고 로그에도 남기지 않는다.
export async function POST(request: Request) {
  let pass: PaidPass | undefined;
  try {
    sameOrigin(request);
    pass = await paidGuard(request, "stt", ["service", "health"]);
    const config = sttConfig();
    if (Number(request.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 100000) {
      throw new ApiError(413, "AUDIO_TOO_LARGE", "녹음이 너무 깁니다. 5분 안쪽으로 나눠서 말해 주세요.");
    }
    const form = await request.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof File)) throw new ApiError(400, "INVALID_INPUT", "녹음을 받지 못했습니다. 다시 녹음해 주세요.");
    return Response.json({ text: await transcribe(audio, config) }, { headers: privateHeaders });
  } catch (error) {
    // 결과를 돌려주지 못했으면 이번에 깎은 횟수를 돌려준다.
    await pass?.refund();
    return failure(error);
  }
}
