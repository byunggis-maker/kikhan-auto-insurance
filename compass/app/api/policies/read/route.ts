import { ApiError, failure, privateHeaders, sameOrigin } from "@/lib/guard/http";
import { paidGuard, type PaidPass } from "@/lib/guard/paid";
import { MAX_FILE_BYTES, prepareFile } from "@/lib/extract/file";
import { providerCall, readPolicy, visionConfig } from "@/lib/extract/vision";
import type { ReadResponse } from "@/lib/schemas/policy-reading";

export const maxDuration = 60;

// 증권·가입증명서 파일을 읽어 판독 결과를 돌려준다.
// 파일은 이 요청의 메모리에서만 다루고 저장하지 않는다. 내용은 로그에 남기지 않는다.
export async function POST(request: Request) {
  let pass: PaidPass | undefined;
  try {
    sameOrigin(request);
    // 유료 기능이다. 문지기를 통과하지 못하면 제공자를 부르기 전에 끝낸다.
    pass = await paidGuard(request, "policy-read", ["service"]);
    const config = visionConfig();

    // 여러 부분으로 나뉜 요청의 머리말 몫으로 조금 여유를 둔다.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 100000) {
      throw new ApiError(413, "FILE_TOO_LARGE", "파일이 너무 큽니다. 4MB 이하의 파일을 올려 주세요.");
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "INVALID_INPUT", "파일을 골라 주세요.");
    const password = form?.get("password");

    const bytes = new Uint8Array(await file.arrayBuffer());
    // 같은 이용권으로 같은 파일을 다시 읽으면 횟수를 깎지 않는다(화면도 읽은 결과를 다시 쓴다).
    await pass.sameFile(bytes);
    const prepared = await prepareFile(bytes, {
      password: typeof password === "string" && password.length > 0 && password.length <= 64 ? password : undefined,
    });
    const reading = await readPolicy(prepared, providerCall(config));
    const body: ReadResponse = { reading, source: prepared.source };
    return Response.json(body, { headers: privateHeaders });
  } catch (error) {
    // 결과를 돌려주지 못했으면 이번에 깎은 횟수를 돌려준다.
    await pass?.refund();
    return failure(error);
  }
}
