import { ApiError } from "@/lib/guard/http";
import { isPrecedentKeyword } from "@/lib/law/catalog";
import { LAW_FAILED, searchPrecedents } from "@/lib/law/client";

// 참고 판례 목록을 돌려준다. 정해 둔 검색어(lib/law/catalog.ts)로만 찾고 결과는 24시간 저장해 둔다.
// 사고 내용이나 개인정보는 국가법령정보센터로 보내지 않는다.
const HEADERS = { "Cache-Control": "public, max-age=3600, s-maxage=86400", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const keyword = new URL(request.url).searchParams.get("q") ?? "";
  if (!isPrecedentKeyword(keyword)) return Response.json({ error: LAW_FAILED, code: "INVALID_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ keyword, precedents: await searchPrecedents(keyword) }, { headers: HEADERS });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502;
    return Response.json({ error: LAW_FAILED, code: error instanceof ApiError ? error.code : "LAW_FAILED" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
