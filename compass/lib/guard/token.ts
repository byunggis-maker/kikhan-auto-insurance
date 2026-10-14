import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 분석 이용권: 서버 비밀값(GUARD_SECRET)으로 서명한 짧은 문자열. 사람에 대한 정보는 담지 않는다(번호·발급·만료 시각뿐).
// 서명이 맞아도 저장소에 발급 기록(kc2:tk:<번호>)이 없으면 받지 않는다(lib/guard/paid.ts).

const PREFIX = "kc2t1";

export type TicketClaims = {
  /** 이용권 번호(임의값) */
  jti: string;
  /** 발급 시각(초) */
  iat: number;
  /** 만료 시각(초) */
  exp: number;
  /** 무료 이용권. 결제를 붙이면 "paid"를 더한다(PLAN 3절 "결제를 붙일 자리"). */
  plan: "free";
};

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(`${PREFIX}.${body}`).digest("base64url");

export function newTicketId() {
  return randomBytes(16).toString("base64url");
}

export function signTicket(claims: TicketClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${PREFIX}.${body}.${sign(secret, body)}`;
}

export type TicketCheck = { ok: true; claims: TicketClaims } | { ok: false; reason: "missing" | "invalid" | "expired" };

/** 서명과 유효 시간을 본다. nowSeconds는 서버 시계. */
export function verifyTicket(token: string | null | undefined, secret: string, nowSeconds: number): TicketCheck {
  if (!token) return { ok: false, reason: "missing" };
  if (token.length > 400) return { ok: false, reason: "invalid" };
  const [prefix, body, signature, extra] = token.split(".");
  if (prefix !== PREFIX || !body || !signature || extra !== undefined) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const c = claims as Partial<TicketClaims>;
  if (typeof c.jti !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(c.jti) || !Number.isInteger(c.iat) || !Number.isInteger(c.exp) || c.plan !== "free") {
    return { ok: false, reason: "invalid" };
  }
  // 발급 시각이 미래(시계 오차 1분 넘게)인 것은 위조로 본다.
  if (c.iat! > nowSeconds + 60) return { ok: false, reason: "invalid" };
  if (c.exp! <= nowSeconds) return { ok: false, reason: "expired" };
  return { ok: true, claims: c as TicketClaims };
}

/** IP 원문 대신 쓰는 값. 비밀값 없이는 IP로 되돌릴 수 없다. 원문 IP는 어디에도 남기지 않는다. */
export function ipKey(ip: string, secret: string) {
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("base64url").slice(0, 32);
}

/** 파일·Turnstile 토큰을 가리키는 값. 원래 내용은 남기지 않는다. */
export function digestKey(value: Uint8Array | string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url").slice(0, 43);
}
