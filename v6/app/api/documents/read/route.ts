import { InputError, NO_STORE, hasApiKey, invalidResponse, unavailableResponse } from "@/lib/ai/anthropic";
import { MAX_FILE_BYTES, claudeCall, readClaimDocument, readPolicyDocument } from "@/lib/ai/documents";

export const maxDuration = 60;

// MASTER.md 9장: 서류 인식(POST, 본문 form "file" + "kind"(policy | claim) + claim이면 "target"(person | property)).
// 서버에서만 ANTHROPIC_API_KEY를 쓴다. 파일은 이 요청의 메모리에서만 다루고 저장하지 않으며, 내용은 로그에 남기지 않는다.
// 키가 없거나 제공자가 실패하면 503 "준비 중". 응답의 글자는 모두 개인정보를 가린 것이다.
export async function POST(request: Request) {
  if (!hasApiKey()) return unavailableResponse();
  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 100_000) throw new InputError(413, "파일이 너무 큽니다. 4MB 이하의 파일을 올려 주세요.");
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) throw new InputError(400, "파일을 골라 주세요.");
    const kind = form?.get("kind");
    const target = form?.get("target");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const call = claudeCall(process.env.ANTHROPIC_API_KEY!.trim());
    if (kind === "policy") return Response.json({ ok: true, kind, ...(await readPolicyDocument(bytes, call)) }, { headers: NO_STORE });
    if (kind === "claim" && (target === "person" || target === "property"))
      return Response.json({ ok: true, kind, target, ...(await readClaimDocument(bytes, target, call)) }, { headers: NO_STORE });
    throw new InputError(400, "어떤 서류인지 알 수 없습니다. 다시 시도해 주세요.");
  } catch (error) {
    if (error instanceof InputError) return invalidResponse(error.status, error.message);
    return unavailableResponse();
  }
}
