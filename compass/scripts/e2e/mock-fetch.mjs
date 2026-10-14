// 통합 점검용. 서버 프로세스에 미리 불러와(NODE_OPTIONS=--import) LLM·음성 제공자로 가는 요청을 가짜 서버로 돌린다.
// 실제 키 없이 화면 흐름 전체를 확인하기 위한 것이다. 운영 코드에서는 쓰지 않는다.
const MOCK = process.env.E2E_MOCK_URL;
if (MOCK) {
  const real = globalThis.fetch;
  const routes = { "api.anthropic.com": "/llm/anthropic", "api.openai.com": "/llm/openai" };
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const prefix = routes[url.hostname];
    return prefix ? real(`${MOCK}${prefix}${url.pathname}${url.search}`, init) : real(input, init);
  };
}
