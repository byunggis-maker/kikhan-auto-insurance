import { unavailableResponse } from "@/lib/ai/anthropic";

// MASTER.md 9장: 음성→문자 변환 API 라우트(POST). 변환은 라운드 7에서 넣는다. 그 전까지(또는 키가 없으면) "준비 중".
export async function POST() {
  return unavailableResponse();
}
