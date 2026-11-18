import { connection } from "next/server";
import { NO_STORE, keyState } from "@/lib/ai/anthropic";

// 라운드 9b: 키 만료 안내용(결과 화면 맨 아래). 키 값은 알려 주지 않고 상태만 준다: ok | soon(만료 7일 전부터) | expired
export async function GET() {
  await connection();
  return Response.json({ ok: true, state: keyState() }, { headers: NO_STORE });
}
