import { unavailableResponse } from "@/lib/ai/anthropic";

// MASTER.md 9장: 서류 인식 API 라우트(POST). 서버에서만 ANTHROPIC_API_KEY를 쓴다. 인식은 라운드 7에서 넣는다.
// 그 전까지(또는 키가 없으면) "준비 중"을 돌려주고 앱의 나머지는 그대로 동작한다.
export async function POST() {
  return unavailableResponse();
}
