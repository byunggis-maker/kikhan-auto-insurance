import { ZodError } from "zod";

/** 화면에 그대로 보여 줄 수 있는 오류. 비밀값이나 제공자 응답 원문을 싣지 않는다. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public publicMessage: string,
  ) {
    super(code);
  }
}

export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/** 다른 사이트에서 보낸 요청은 받지 않는다. */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "ORIGIN", "현재 페이지에서 다시 시도해 주세요.");
  }
}

export function failure(error: unknown) {
  if (error instanceof ZodError) {
    return Response.json({ error: "입력값을 확인해 주세요.", code: "INVALID_INPUT" }, { status: 400, headers: privateHeaders });
  }
  if (error instanceof ApiError) {
    return Response.json({ error: error.publicMessage, code: error.code }, { status: error.status, headers: privateHeaders });
  }
  // 원래 오류 내용은 응답에 싣지 않는다.
  return Response.json({ error: "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "REQUEST_FAILED" }, { status: 500, headers: privateHeaders });
}

/** JSON을 받는 POST 라우트의 공통 틀: 출처 확인, 크기 제한, 오류를 정해진 모양으로. */
export async function jsonRoute(request: Request, handler: (body: unknown) => Promise<unknown>) {
  try {
    sameOrigin(request);
    const text = await request.text();
    if (text.length > 20000) throw new ApiError(413, "TOO_LARGE", "요청이 너무 큽니다.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(400, "INVALID_INPUT", "입력값을 확인해 주세요.");
    }
    return Response.json(await handler(body), { headers: privateHeaders });
  } catch (error) {
    return failure(error);
  }
}
