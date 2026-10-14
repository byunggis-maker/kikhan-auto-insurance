// 유료 기능 문지기의 설정. 값은 모두 서버 환경변수에서 읽고, 화면에는 Turnstile 사이트 키와 한도만 넘긴다.

/** 유료 API를 부르는 라우트. 이 목록에 없는 라우트는 제공자를 부르면 안 된다(tests/paid-routes.test.ts). */
export const PAID_ROUTES = {
  "policy-read": { path: "/api/policies/read", label: "증권 읽기" },
  stt: { path: "/api/stt", label: "음성을 글로 바꾸기" },
  extract: { path: "/api/extract/accident", label: "사고 내용 정리" },
  explain: { path: "/api/explain", label: "쉬운 말 설명" },
  tts: { path: "/api/tts", label: "읽어주기" },
} as const;

export type PaidRoute = keyof typeof PAID_ROUTES;
export const PAID_ROUTE_IDS = Object.keys(PAID_ROUTES) as PaidRoute[];

/** 이용권 1장으로 쓸 수 있는 경로별 횟수(사용자와 정한 값, 2026-10-14) */
const DEFAULT_CALLS: Record<PaidRoute, number> = { "policy-read": 3, stt: 5, extract: 5, explain: 10, tts: 10 };

/** 같은 이용권으로 같은 경로를 다시 부를 수 있기까지의 간격. 읽어주기는 문단을 이어서 받으므로 짧게 둔다. */
export const MIN_INTERVAL_MS: Record<PaidRoute, number> = { "policy-read": 3000, stt: 3000, extract: 3000, explain: 1000, tts: 1000 };

/** 같은 파일을 같은 이용권으로 다시 읽을 때 횟수를 깎지 않는 최대 번수 */
export const FREE_REPEATS_PER_FILE = 2;

/** 이용권 발급 시도(Turnstile 확인)의 IP당 시간당 상한. 하루 이용권 수와 별개로 확인 요청 남발을 막는다. */
export const TICKET_TRIES_PER_HOUR = 20;

/** Upstash가 없어 메모리 카운터로 돌 때(간이 모드) IP당 하루 유료 호출 상한(사용자 지시, 2026-10-15) */
export const FALLBACK_DAILY_CALLS = 30;

export type GuardConfig = {
  secret: string;
  /** Turnstile 키가 없으면 null: 이용권 발급 때 봇 확인을 건너뛴다(간이 모드). 키를 넣으면 다시 확인한다. */
  turnstile: { siteKey: string; secretKey: string } | null;
  dailyTickets: number;
  ticketTtlSeconds: number;
  calls: Record<PaidRoute, number>;
};

type Env = Record<string, string | undefined>;

/**
 * Cloudflare가 공개한 Turnstile 시험용 비밀 키(1x…: 늘 통과, 2x…: 늘 실패, 3x…: 이미 쓴 토큰).
 * 시험용 키는 매번 같은 가짜 토큰을 주므로, 이 키를 쓸 때는 서버의 "같은 토큰 재사용" 검사를 건너뛴다.
 */
export const isTurnstileTestSecret = (secretKey: string) => /^[123]x0{31}AA$/.test(secretKey);

function whole(value: string | undefined, fallback: number, max: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback;
}

/** "policy-read=3,stt=5" 꼴. 적지 않은 경로와 잘못 적은 값은 기본값을 쓴다. */
function callLimits(value: string | undefined): Record<PaidRoute, number> {
  const calls = { ...DEFAULT_CALLS };
  for (const part of (value ?? "").split(",")) {
    const [key, count] = part.split("=").map((s) => s.trim());
    if (key in calls) calls[key as PaidRoute] = whole(count, calls[key as PaidRoute], 100);
  }
  return calls;
}

/** GUARD_SECRET이 없으면 null. 그때 유료 기능은 모두 막히고 직접 입력·계산만 된다. */
export function readGuardConfig(env: Env = process.env): GuardConfig | null {
  const secret = env.GUARD_SECRET ?? "";
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (secret.length < 32) return null;
  // 실제 배포에 시험용 키가 들어가면 누구나 통과하므로 유료 기능을 막는다.
  if (env.VERCEL_ENV === "production" && isTurnstileTestSecret(secretKey)) return null;
  return {
    secret,
    turnstile: siteKey && secretKey ? { siteKey, secretKey } : null,
    dailyTickets: whole(env.DAILY_TICKET_LIMIT, 3, 100),
    ticketTtlSeconds: whole(env.TICKET_TTL_MINUTES, 120, 24 * 60) * 60,
    calls: callLimits(env.TICKET_CALL_LIMITS),
  };
}
