import { ApiError } from "@/lib/guard/http";

// LLM에게 정해진 JSON 모양으로만 답하게 하는 공통 호출. 증권 읽기와 사고 사실 추출이 함께 쓴다.
// LLM은 계산하지 않는다. 제공자의 응답 원문은 오류 메시지나 로그에 싣지 않는다.

export type LlmConfig = { provider: "openai" | "anthropic"; model: string; key: string };

export type StructuredRequest = {
  instructions: string;
  userText: string;
  /** JPEG 그림들 */
  images: Buffer[];
  /** 응답이 따라야 하는 JSON 스키마 */
  schema: Record<string, unknown>;
  /** 스키마의 이름 */
  name: string;
};

/** 오류를 어떤 코드와 문구로 알릴지. 쓰는 곳마다 안내가 다르다. */
export type LlmErrors = { prefix: string; failed: string; config: string };

/** 환경변수에서 제공자·모델·키를 읽는다. 하나라도 없으면 null. */
export function readLlmConfig(kind: "VISION" | "LLM", env: Record<string, string | undefined>): LlmConfig | null {
  const provider = env[`${kind}_PROVIDER`]?.trim();
  const model = env[`${kind}_MODEL`]?.trim();
  const key = (provider === "openai" ? env.OPENAI_API_KEY : provider === "anthropic" ? env.ANTHROPIC_API_KEY : undefined)?.trim();
  return (provider === "openai" || provider === "anthropic") && model && key ? { provider, model, key } : null;
}

export async function postJson(url: string, headers: Record<string, string>, body: BodyInit, errors: LlmErrors): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body, cache: "no-store", signal: AbortSignal.timeout(50000) });
  } catch {
    throw new ApiError(502, `${errors.prefix}_FAILED`, errors.failed);
  }
  if (!response.ok) {
    const config = response.status === 401 || response.status === 403 || response.status === 404;
    throw new ApiError(502, `${errors.prefix}_${config ? "CONFIG" : "FAILED"}`, config ? errors.config : errors.failed);
  }
  return response.json().catch(() => null);
}

/** 제공자를 한 번 불러 JSON(아직 검증하지 않은 값)을 돌려준다. 모양이 아예 다르면 null. */
export async function callStructured(config: LlmConfig, request: StructuredRequest, errors: LlmErrors): Promise<unknown> {
  const json = { "Content-Type": "application/json" };
  if (config.provider === "anthropic") {
    const data = (await postJson(
      "https://api.anthropic.com/v1/messages",
      { ...json, "x-api-key": config.key, "anthropic-version": "2023-06-01" },
      JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        system: request.instructions,
        tools: [{ name: request.name, description: "옮겨 적은 내용을 기록한다.", input_schema: request.schema }],
        tool_choice: { type: "tool", name: request.name },
        messages: [
          {
            role: "user",
            content: [
              ...request.images.map((image) => ({
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") },
              })),
              { type: "text", text: request.userText },
            ],
          },
        ],
      }),
      errors,
    )) as { content?: { type?: string; input?: unknown }[] } | null;
    return data?.content?.find((block) => block.type === "tool_use")?.input ?? null;
  }
  const data = (await postJson(
    "https://api.openai.com/v1/chat/completions",
    { ...json, Authorization: `Bearer ${config.key}` },
    JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: request.instructions },
        {
          role: "user",
          content: [
            { type: "text", text: request.userText },
            ...request.images.map((image) => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` },
            })),
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: request.name, strict: true, schema: request.schema } },
    }),
    errors,
  )) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** zod 스키마에서 만든 JSON 스키마에서 제공자가 받지 않는 머리말을 뺀다. */
export function plainSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema"));
}
