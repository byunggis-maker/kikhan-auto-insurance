"use client";

/**
 * 화면이 유료 기능(증권 읽기, 음성 변환, 사실 추출, 쉬운 말 설명, 읽어주기) 버튼을 보여 줄지 정한다.
 * 2단계: 로그인을 걷어 낸 자리라 아직 쓸 수 없다. 4단계에서 이용권(Turnstile + 하루 3장) 상태를 돌려준다.
 */
export function usePaid(): { ready: boolean } {
  return { ready: false };
}
