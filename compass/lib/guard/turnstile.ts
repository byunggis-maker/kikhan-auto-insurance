// Cloudflare Turnstile 토큰을 서버에서 확인한다. 토큰은 한 번만 쓸 수 있고(Cloudflare가 거절), 서버도 같은 토큰을 다시 받지 않는다(lib/guard/ticket.ts).
// 사용자의 IP는 보내지 않는다(선택 항목).

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = "ok" | "rejected" | "unavailable";

export async function verifyTurnstile(token: string, secretKey: string, fetcher: typeof fetch = fetch): Promise<TurnstileResult> {
  let response: Response;
  try {
    response = await fetcher(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: secretKey, response: token }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch {
    return "unavailable";
  }
  if (!response.ok) return "unavailable";
  const body = (await response.json().catch(() => null)) as { success?: unknown } | null;
  return body?.success === true ? "ok" : "rejected";
}
