import type { ConsentKind } from "@/lib/privacy/consent";
import { ApiError } from "./http";

// 화면의 안내(components/ui.tsx의 PaidNotice)와 같은 문구다.
export const PAID_NOT_READY_MESSAGE = "이 기능은 준비 중입니다. 직접 입력해 계산할 수 있어요";

/**
 * 유료 API(증권 읽기, 음성 변환, 사고 사실 추출, 쉬운 말 설명, 읽어주기)를 부르는 라우트는
 * 맨 먼저 이 함수를 불러야 한다. 통과하지 못하면 제공자를 부르기 전에 끝난다.
 *
 * 2단계: 로그인을 걷어 낸 자리. 이용권(Turnstile + 하루 3장)과 Vercel Firewall 한도는 4단계에서 붙인다.
 * 그 전까지는 모든 요청을 막아 제공자 비용이 생기지 않게 한다.
 */
export async function paidGuard(request: Request, needs: ConsentKind[]): Promise<void> {
  void request;
  void needs;
  throw new ApiError(503, "PAID_NOT_READY", PAID_NOT_READY_MESSAGE);
}
