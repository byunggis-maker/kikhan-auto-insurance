// 동의 문안의 버전. 문안을 바꾸면 버전을 올리고, 옛 버전에 동의한 사용자는 다시 동의를 받는다.
// 문안은 아직 초안이다(법무 확인 전). 서버(lib/guard/paid.ts)도 이 값으로 요청의 동의 버전을 확인하므로 "use client" 파일과 나눠 둔다.
export const CONSENT_VERSIONS = {
  service: "2026-10-14-v2-draft",
  health: "2026-10-14-v2-draft",
} as const;

export type ConsentKind = keyof typeof CONSENT_VERSIONS;
export type ConsentState = Record<ConsentKind, boolean>;
