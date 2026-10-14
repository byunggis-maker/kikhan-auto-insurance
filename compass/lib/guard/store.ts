import { readFileSync } from "node:fs";

// 이용권·사용량 카운터를 두는 곳. 사용자 기록이 아니라 개수와 표시만 둔다(사용자와 정한 B안, 2026-10-14).
// 키에 들어가는 것: IP의 HMAC 값, 날짜, 이용권 번호, 파일의 HMAC 값. 모든 키는 하루 안쪽에 저절로 사라진다.
// 사고 내용·건강정보·증권 내용·IP 원문은 넣지 않는다.

export interface QuotaStore {
  /** 1 올리고 새 값을 돌려준다. 키를 처음 만들 때 ttlSeconds 뒤에 사라지게 한다. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** 1 내린다(쓴 횟수를 돌려줄 때). */
  decr(key: string): Promise<void>;
  /** 없으면 0 */
  get(key: string): Promise<number>;
  /** 키가 없을 때만 만든다. 만들었으면 true. */
  setOnce(key: string, ttlMs: number): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

export type Clock = () => number;

/** 한 프로세스 안에서만 쓰는 저장소. 로컬 개발과 테스트용이다. 여러 인스턴스가 뜨는 배포에서는 쓰지 않는다. */
export class MemoryStore implements QuotaStore {
  private map = new Map<string, { value: number; expiresAt: number }>();
  constructor(private now: Clock = Date.now) {}

  private live(key: string) {
    const entry = this.map.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry;
  }
  async incr(key: string, ttlSeconds: number) {
    const entry = this.live(key) ?? { value: 0, expiresAt: this.now() + ttlSeconds * 1000 };
    entry.value += 1;
    this.map.set(key, entry);
    return entry.value;
  }
  async decr(key: string) {
    const entry = this.live(key);
    if (entry) entry.value -= 1;
  }
  async get(key: string) {
    return this.live(key)?.value ?? 0;
  }
  async setOnce(key: string, ttlMs: number) {
    if (this.live(key)) return false;
    this.map.set(key, { value: 1, expiresAt: this.now() + ttlMs });
    return true;
  }
  async exists(key: string) {
    return this.live(key) !== undefined;
  }
}

export class StoreError extends Error {}

/**
 * Upstash Redis의 REST API를 fetch로 부른다(패키지를 더하지 않는다).
 * 명령은 /pipeline으로 한 번에 보낸다. 응답이나 오류 본문은 로그에 남기지 않는다.
 */
export class UpstashStore implements QuotaStore {
  constructor(
    private url: string,
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {}

  private async run(commands: (string | number)[][]): Promise<unknown[]> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.url.replace(/\/$/, "")}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
    } catch {
      throw new StoreError("store unreachable");
    }
    if (!response.ok) throw new StoreError(`store status ${response.status}`);
    const body = (await response.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
    if (!Array.isArray(body) || body.length !== commands.length || body.some((item) => item?.error)) throw new StoreError("store answer");
    return body.map((item) => item.result);
  }

  async incr(key: string, ttlSeconds: number) {
    const [value] = await this.run([
      ["INCR", key],
      ["EXPIRE", key, ttlSeconds, "NX"],
    ]);
    return Number(value);
  }
  async decr(key: string) {
    await this.run([["DECR", key]]);
  }
  async get(key: string) {
    const [value] = await this.run([["GET", key]]);
    return value === null || value === undefined ? 0 : Number(value);
  }
  async setOnce(key: string, ttlMs: number) {
    const [value] = await this.run([["SET", key, "1", "NX", "PX", ttlMs]]);
    return value === "OK";
  }
  async exists(key: string) {
    const [value] = await this.run([["EXISTS", key]]);
    return Number(value) === 1;
  }
}

type Env = Record<string, string | undefined>;

/**
 * 로컬 개발에서만: GUARD_DEV_CLOCK_FILE에 적힌 밀리초만큼 서버 시계를 옮긴다("다음 날" 시험용).
 * Upstash를 쓰거나 Vercel에서 돌 때는 읽지 않는다.
 */
function devClock(env: Env): Clock {
  const file = env.GUARD_DEV_CLOCK_FILE;
  if (!file) return Date.now;
  return () => {
    try {
      const offset = Number(readFileSync(file, "utf8").trim());
      return Date.now() + (Number.isFinite(offset) ? offset : 0);
    } catch {
      return Date.now();
    }
  };
}

let memory: { store: MemoryStore; clock: Clock } | undefined;

/**
 * 쓸 저장소와 시계. Upstash 설정이 없으면 이 프로세스의 메모리 카운터를 쓴다.
 * fallback: 배포(Vercel)에서 Upstash 없이 메모리로 도는 간이 모드. 서버 인스턴스마다 따로 세고 인스턴스가 바뀌면
 * 처음부터 세므로 막는 힘이 약하다(lib/guard/paid.ts가 IP당 하루 호출 수로 막는다). Upstash를 넣으면 원래대로 돌아간다.
 * 로컬 개발은 한 프로세스라 메모리 카운터로도 원래와 같이 동작한다(fallback: false).
 * Vercel 마켓플레이스로 붙이면 KV_REST_API_URL·KV_REST_API_TOKEN이 생기고, Upstash에서 직접 만들면 UPSTASH_REDIS_REST_* 이름이다.
 */
export function openStore(env: Env = process.env): { store: QuotaStore; clock: Clock; fallback: boolean } {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return { store: new UpstashStore(url, token), clock: Date.now, fallback: false };
  if (!memory) {
    const clock = devClock(env);
    memory = { store: new MemoryStore(clock), clock };
  }
  return { ...memory, fallback: !!env.VERCEL };
}
