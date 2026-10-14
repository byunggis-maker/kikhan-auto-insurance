import { expect, it } from "vitest";
import { ApiError } from "@/lib/guard/http";
import { paidGuard } from "@/lib/guard/paid";

// 2단계: 이용권(4단계)을 붙이기 전까지 문지기는 모든 유료 요청을 막는다. 제공자 비용이 생기지 않아야 한다.
it("이용권을 붙이기 전에는 모든 유료 요청을 막는다", async () => {
  const request = new Request("http://localhost/api/tts", { method: "POST" });
  await expect(paidGuard(request, ["service"])).rejects.toMatchObject({ status: 503, code: "PAID_NOT_READY" });
  await expect(paidGuard(request, ["service", "health"])).rejects.toBeInstanceOf(ApiError);
});
