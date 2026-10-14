import { ApiError } from "@/lib/guard/http";
import { isLawRef } from "@/lib/law/catalog";
import { LAW_FAILED, getArticle } from "@/lib/law/client";

// 법령 조문 원문을 돌려준다. 국가법령정보센터는 서버에서만 부르고, 인증값은 응답에 싣지 않는다.
// 정해 둔 조문(lib/law/catalog.ts)만 조회할 수 있고 결과는 24시간 저장해 둔다. 공개 자료라 로그인 없이 볼 수 있다.
const HEADERS = { "Cache-Control": "public, max-age=3600, s-maxage=86400", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  if (!isLawRef(ref)) return Response.json({ error: LAW_FAILED, code: "INVALID_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ article: await getArticle(ref) }, { headers: HEADERS });
  } catch (error) {
    // 실패한 이유(제공자 응답, 설정)는 싣지 않는다. 화면에는 이 문구만 나온다.
    const status = error instanceof ApiError ? error.status : 502;
    return Response.json({ error: LAW_FAILED, code: error instanceof ApiError ? error.code : "LAW_FAILED" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
