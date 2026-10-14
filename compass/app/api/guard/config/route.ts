import { connection } from "next/server";
import { failure, privateHeaders } from "@/lib/guard/http";
import { guardStatus } from "@/lib/guard/paid";

// 화면이 유료 기능을 보여 줄지 정할 때 부른다: 쓸 수 있는지, Turnstile 사이트 키(공개값), 오늘 남은 이용권 수.
// 비밀값과 IP는 응답에 싣지 않는다.
export async function GET(request: Request) {
  // 요청마다 남은 장수를 새로 센다(빌드 때 미리 만들어 두지 않는다).
  await connection();
  try {
    return Response.json(await guardStatus(request), { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}
