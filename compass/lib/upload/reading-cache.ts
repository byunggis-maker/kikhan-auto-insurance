"use client";

import type { ReadResponse } from "@/lib/schemas/policy-reading";

// 같은 파일을 다시 고르면 서버에 다시 보내지 않고 앞서 읽은 결과를 쓴다(이용권 횟수와 제공자 비용을 아낀다).
// 이 탭의 메모리에만 두고 브라우저 저장소에는 넣지 않는다. 새로고침하면 사라지고, 그때는 서버가 같은 파일의 재판독을 횟수에서 빼 준다.
// 파일 내용 대신 SHA-256 값으로 찾는다.

const MAX_ENTRIES = 5;
const readings = new Map<string, ReadResponse>();

export async function fileDigest(file: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export function cachedReading(digest: string | null): ReadResponse | null {
  return digest ? (readings.get(digest) ?? null) : null;
}

export function rememberReading(digest: string | null, response: ReadResponse) {
  if (!digest) return;
  readings.delete(digest);
  readings.set(digest, response);
  while (readings.size > MAX_ENTRIES) readings.delete(readings.keys().next().value!);
}

export function forgetReadings() {
  readings.clear();
}
