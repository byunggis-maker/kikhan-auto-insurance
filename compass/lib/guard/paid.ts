import { CONSENT_VERSIONS, type ConsentKind } from "@/lib/privacy/consent-versions";
import { FREE_REPEATS_PER_FILE, MIN_INTERVAL_MS, isTurnstileTestSecret, PAID_ROUTES, PAID_ROUTE_IDS, TICKET_TRIES_PER_HOUR, readGuardConfig, type GuardConfig, type PaidRoute } from "./config";
import { ApiError } from "./http";
import { StoreError, openStore, type Clock, type QuotaStore } from "./store";
import { digestKey, ipKey, newTicketId, signTicket, verifyTicket, type TicketClaims } from "./token";
import { verifyTurnstile } from "./turnstile";

// 유료 API(증권 읽기, 음성 변환, 사고 사실 추출, 쉬운 말 설명, 읽어주기)의 문지기. 처리 순서는 docs/PLAN.md 3절.
// 막힌 요청은 제공자를 부르기 전에 끝난다. 이 파일은 요청 본문을 읽지 않고, 무엇도 로그에 남기지 않는다.

/** 요청 머리글 이름. 화면(lib/guard/paid-client.ts)이 같은 이름으로 보낸다. */
export const TICKET_HEADER = "x-kc2-ticket";
export const CONSENT_HEADER = "x-kc2-consent";

export const PAID_UNAVAILABLE_MESSAGE = "자동 기능은 준비 중입니다. 직접 입력해 계산할 수 있어요.";

export type GuardDeps = { config: GuardConfig; store: QuotaStore; clock: Clock; fetcher?: typeof fetch };

/** 환경변수로 정한 설정과 저장소. 하나라도 없으면 null(유료 기능 막힘). */
export function guardDeps(env: Record<string, string | undefined> = process.env): GuardDeps | null {
  const config = readGuardConfig(env);
  if (!config || config.dailyTickets === 0) return null;
  const opened = openStore(env);
  return opened ? { config, ...opened } : null;
}

const unavailable = () => new ApiError(503, "PAID_UNAVAILABLE", PAID_UNAVAILABLE_MESSAGE);

/** 저장소 장애는 사용자가 이해할 수 있는 안내로 바꾼다. 원래 오류 내용은 싣지 않는다. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StoreError) throw unavailable();
    throw error;
  }
}

/** 화면이 보낸 동의 버전("service:<버전>,health:<버전>") 중 지금 문안과 같은 것 */
export function consentFrom(request: Request): Set<ConsentKind> {
  const given = new Set<ConsentKind>();
  for (const part of (request.headers.get(CONSENT_HEADER) ?? "").slice(0, 200).split(",")) {
    const [kind, version] = part.split(":").map((s) => s.trim());
    if (kind in CONSENT_VERSIONS && CONSENT_VERSIONS[kind as ConsentKind] === version) given.add(kind as ConsentKind);
  }
  return given;
}

function requireConsent(request: Request, needs: ConsentKind[]) {
  const given = consentFrom(request);
  if (needs.includes("service") && !given.has("service")) throw new ApiError(403, "CONSENT_REQUIRED", "서비스 이용 동의가 필요합니다. 동의 화면에서 동의한 뒤 다시 시도해 주세요.");
  if (needs.includes("health") && !given.has("health")) throw new ApiError(403, "HEALTH_CONSENT_REQUIRED", "건강정보 처리 동의가 필요합니다. 동의 화면에서 건강정보 항목에 동의하면 쓸 수 있어요.");
}

/** 한국 시각의 날짜(YYYY-MM-DD). 하루 이용권은 한국 시각 자정에 다시 생긴다. */
export function koreanDay(ms: number) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date(ms));
}

function koreanHour(ms: number) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** 요청한 곳의 IP. Vercel이 붙이는 머리글을 쓴다. 원문은 바로 HMAC으로 바꾸고 남기지 않는다. */
function clientIp(request: Request) {
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

const DAY_TTL = 2 * 24 * 60 * 60;
const keys = {
  day: (ip: string, day: string) => `kc2:day:${ip}:${day}`,
  tries: (ip: string, hour: string) => `kc2:try:${ip}:${hour}`,
  turnstile: (digest: string) => `kc2:ts:${digest}`,
  ticket: (jti: string) => `kc2:tk:${jti}`,
  use: (jti: string, route: PaidRoute) => `kc2:use:${jti}:${route}`,
  all: (jti: string) => `kc2:all:${jti}`,
  fast: (jti: string, route: PaidRoute) => `kc2:fast:${jti}:${route}`,
  file: (jti: string, digest: string) => `kc2:file:${jti}:${digest}`,
};

export type GuardStatus = {
  enabled: boolean;
  siteKey: string | null;
  limit: number;
  remaining: number;
  ttlMinutes: number;
  calls: Record<PaidRoute, number> | null;
};

/** 화면에 보여 줄 오늘 남은 이용권 수와 Turnstile 사이트 키 */
export async function guardStatus(request: Request, deps: GuardDeps | null = guardDeps()): Promise<GuardStatus> {
  if (!deps) return { enabled: false, siteKey: null, limit: 0, remaining: 0, ttlMinutes: 0, calls: null };
  const { config, store, clock } = deps;
  const used = await guarded(() => store.get(keys.day(ipKey(clientIp(request), config.secret), koreanDay(clock()))));
  return {
    enabled: true,
    siteKey: config.turnstile.siteKey,
    limit: config.dailyTickets,
    remaining: Math.max(0, config.dailyTickets - used),
    ttlMinutes: config.ticketTtlSeconds / 60,
    calls: config.calls,
  };
}

export const dailyLimitMessage = (limit: number) =>
  `오늘 받을 수 있는 이용권 ${limit}장을 모두 받았습니다. 내일(한국 시각 자정이 지나면) 다시 받을 수 있어요. 직접 입력과 계산은 계속 쓸 수 있어요.`;

/** expiresIn: 남은 초. 기기 시계가 서버와 달라도 화면이 남은 시간을 바르게 세도록 시각 대신 길이를 준다. */
export type IssuedTicket = { ticket: string; expiresIn: number; remaining: number; limit: number; calls: Record<PaidRoute, number> };

/**
 * 분석 이용권 발급. 순서: 동의 → 시도 횟수 → 오늘 남은 장수 → 같은 Turnstile 토큰 재사용 → Turnstile 확인 → 발급.
 * 결제를 붙일 자리: 유료 이용권(plan "paid")은 결제 확인 뒤 여기서 따로 발급하고, 하루 무료 장수와 따로 센다. 이번 단계에서는 무료 이용권만 있다.
 */
export async function issueTicket(request: Request, turnstileToken: string, deps: GuardDeps | null = guardDeps()): Promise<IssuedTicket> {
  if (!deps) throw unavailable();
  const { config, store, clock } = deps;
  requireConsent(request, ["service"]);
  return guarded(async () => {
    const now = clock();
    const ip = ipKey(clientIp(request), config.secret);
    const dayKey = keys.day(ip, koreanDay(now));
    if ((await store.incr(keys.tries(ip, koreanHour(now)), 60 * 60)) > TICKET_TRIES_PER_HOUR) {
      throw new ApiError(429, "TOO_MANY_TRIES", "이용권 요청이 너무 잦습니다. 한 시간쯤 뒤에 다시 시도해 주세요.");
    }
    if ((await store.get(dayKey)) >= config.dailyTickets) throw new ApiError(429, "DAILY_LIMIT", dailyLimitMessage(config.dailyTickets));
    const testKey = isTurnstileTestSecret(config.turnstile.secretKey);
    if (!testKey && !(await store.setOnce(keys.turnstile(digestKey(turnstileToken, config.secret)), 10 * 60 * 1000))) {
      throw new ApiError(400, "TURNSTILE_REUSED", "이미 쓴 확인입니다. 확인을 다시 한 뒤 눌러 주세요.");
    }
    const verdict = await verifyTurnstile(turnstileToken, config.turnstile.secretKey, deps.fetcher);
    if (verdict === "rejected") throw new ApiError(400, "TURNSTILE_FAILED", "사람인지 확인하지 못했습니다. 확인을 다시 한 뒤 눌러 주세요.");
    if (verdict === "unavailable") throw new ApiError(503, "TURNSTILE_UNAVAILABLE", "확인 서비스에 연결하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.");
    const used = await store.incr(dayKey, DAY_TTL);
    if (used > config.dailyTickets) {
      await store.decr(dayKey);
      throw new ApiError(429, "DAILY_LIMIT", dailyLimitMessage(config.dailyTickets));
    }
    const iat = Math.floor(now / 1000);
    const claims: TicketClaims = { jti: newTicketId(), iat, exp: iat + config.ticketTtlSeconds, plan: "free" };
    await store.setOnce(keys.ticket(claims.jti), config.ticketTtlSeconds * 1000);
    return { ticket: signTicket(claims, config.secret), expiresIn: config.ticketTtlSeconds, remaining: config.dailyTickets - used, limit: config.dailyTickets, calls: config.calls };
  });
}

/** 문지기를 통과한 요청. 제공자를 부르기 전에 실패하면 refund()로 쓴 횟수를 돌려준다. */
export type PaidPass = {
  claims: TicketClaims;
  /** 이 요청으로 깎은 1회를 돌려준다. 여러 번 불러도 한 번만 돌려준다. */
  refund(): Promise<void>;
  /** 같은 이용권으로 같은 파일을 다시 읽는 것이면(FREE_REPEATS_PER_FILE번까지) 횟수를 깎지 않는다. */
  sameFile(bytes: Uint8Array): Promise<boolean>;
};

const usedUpMessage = (route: PaidRoute, count: number) =>
  `이 이용권으로 쓸 수 있는 ${PAID_ROUTES[route].label} ${count}번을 모두 썼습니다. 새 이용권을 받거나 직접 입력해 주세요.`;

/** paidGuard의 본체. 시험에서 설정·저장소·시계를 바꿔 끼울 수 있게 나눠 둔다. */
export async function checkPaid(request: Request, route: PaidRoute, needs: ConsentKind[], deps: GuardDeps | null): Promise<PaidPass> {
  if (!PAID_ROUTE_IDS.includes(route)) throw unavailable();
  if (!deps) throw unavailable();
  const { config, store, clock } = deps;
  requireConsent(request, needs);

  const check = verifyTicket(request.headers.get(TICKET_HEADER), config.secret, Math.floor(clock() / 1000));
  if (!check.ok) {
    if (check.reason === "missing") throw new ApiError(401, "TICKET_REQUIRED", "분석 이용권이 필요합니다. 이용권을 받은 뒤 다시 눌러 주세요.");
    if (check.reason === "expired") throw new ApiError(401, "TICKET_EXPIRED", `이용권의 사용 시간(${config.ticketTtlSeconds / 60}분)이 끝났습니다. 새 이용권을 받아 주세요.`);
    throw new ApiError(401, "TICKET_INVALID", "이용권을 확인하지 못했습니다. 새 이용권을 받아 주세요.");
  }
  const { claims } = check;
  const ttl = Math.max(1, claims.exp - Math.floor(clock() / 1000));
  const cap = config.calls[route];
  const useKey = keys.use(claims.jti, route);

  await guarded(async () => {
    // 서명이 맞아도 이 서버가 발급한 기록이 없으면 받지 않는다(비밀값이 바뀌기 전의 이용권, 지어낸 번호).
    if (!(await store.exists(keys.ticket(claims.jti)))) throw new ApiError(401, "TICKET_INVALID", "이용권을 확인하지 못했습니다. 새 이용권을 받아 주세요.");
    if (cap === 0) throw new ApiError(429, "TICKET_USED_UP", usedUpMessage(route, 0));
    if (!(await store.setOnce(keys.fast(claims.jti, route), MIN_INTERVAL_MS[route]))) {
      throw new ApiError(429, "TOO_FAST", "조금 천천히 눌러 주세요. 몇 초 뒤에 다시 시도해 주세요.");
    }
    // 돌려받은 횟수까지 합친 전체 시도 수. 실패를 되풀이해 제공자를 계속 부르는 것을 막는다.
    const total = Object.values(config.calls).reduce((sum, count) => sum + count, 0) * 2;
    if ((await store.incr(keys.all(claims.jti), ttl)) > total) throw new ApiError(429, "TICKET_USED_UP", "이 이용권으로 할 수 있는 시도를 모두 썼습니다. 새 이용권을 받거나 직접 입력해 주세요.");
    if ((await store.incr(useKey, ttl)) > cap) {
      await store.decr(useKey);
      throw new ApiError(429, "TICKET_USED_UP", usedUpMessage(route, cap));
    }
  });

  let refunded = false;
  const refund = async () => {
    if (refunded) return;
    refunded = true;
    await store.decr(useKey).catch(() => undefined);
  };
  return {
    claims,
    refund,
    async sameFile(bytes) {
      const seen = await guarded(() => store.incr(keys.file(claims.jti, digestKey(bytes, config.secret)), ttl));
      if (seen < 2 || seen - 1 > FREE_REPEATS_PER_FILE) return false;
      await refund();
      return true;
    },
  };
}

/**
 * 유료 API를 부르는 라우트는 맨 먼저 이 함수를 불러야 한다(tests/paid-routes.test.ts가 확인한다).
 * 확인 순서: 설정 → 동의 버전 → 이용권(서명·만료·발급 기록) → 연속 요청 간격 → 이 경로의 남은 횟수.
 * 통과하지 못하면 ApiError를 던지고, 제공자는 불리지 않는다.
 */
export async function paidGuard(request: Request, route: PaidRoute, needs: ConsentKind[]): Promise<PaidPass> {
  return checkPaid(request, route, needs, guardDeps());
}
