import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { consentChecks, ConsentView } from "@/components/ConsentForm";
import { CONSENT_KEY, CONSENT_VERSIONS, readConsent, saveConsent, type ConsentState, type ConsentStorage } from "@/lib/privacy/consent";

// 동의는 사용자가 직접 체크해야 한다. 미리 체크된 상자로 동의를 받으면 안 된다.
// 화면의 체크 상태는 consentChecks(저장된 동의 기록, 사용자가 이번에 고친 값)로만 정해진다.

function memoryStorage(): ConsentStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

/** 동의 화면을 그린 HTML에서 체크된 상자 수 */
function checkedBoxes(checks: ConsentState): number {
  const html = renderToStaticMarkup(createElement(ConsentView, { checks, withdrawingHealth: false, message: "", onChange: () => {}, onSubmit: () => {} }));
  expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  return (html.match(/<input[^>]*\schecked=""/g) ?? []).length;
}

/** 페이지를 처음 열거나 새로고침한 상태: 사용자가 이번에 고친 값은 없다. */
const openPage = (storage: ConsentStorage | null) => consentChecks(readConsent(storage), {});

describe("동의 체크박스", () => {
  it("처음 접속하면 동의 체크박스는 항상 비어 있다", () => {
    const storage = memoryStorage();
    expect(openPage(storage)).toEqual({ service: false, health: false });
    expect(checkedBoxes(openPage(storage))).toBe(0);
    // 저장소를 쓸 수 없는 브라우저(사생활 보호 모드 등)에서도 비어 있다.
    expect(checkedBoxes(openPage(null))).toBe(0);
  });

  it("새로고침해도 사용자가 체크하지 않았으면 비어 있다", () => {
    const storage = memoryStorage();
    // 상자를 체크했지만 "동의하고 계속"을 누르지 않고 새로고침했다.
    const beforeReload = consentChecks(readConsent(storage), { service: true, health: true });
    expect(checkedBoxes(beforeReload)).toBe(2);
    expect(storage.map.size).toBe(0);
    expect(checkedBoxes(openPage(storage))).toBe(0);
    // 몇 번을 새로고침해도 마찬가지다.
    for (let i = 0; i < 3; i++) expect(openPage(storage)).toEqual({ service: false, health: false });
  });

  it("깨진 기록, 옛 문안 버전의 동의, 모양이 다른 값은 동의로 보지 않는다", () => {
    for (const raw of ["{not json", "true", "[]", '{"service":true,"health":true}', '{"service":{"version":"2026-01-01-v1"},"health":{"version":"2026-01-01-v1"}}']) {
      const storage = memoryStorage();
      storage.setItem(CONSENT_KEY, raw);
      expect(checkedBoxes(openPage(storage))).toBe(0);
    }
  });

  it("사용자가 직접 체크해 저장한 항목만, 그 항목만 다시 체크되어 보인다", () => {
    const storage = memoryStorage();
    expect(saveConsent({ service: true, health: false }, new Date("2026-10-14T00:00:00Z"), storage)).toBe(true);
    expect(openPage(storage)).toEqual({ service: true, health: false });
    expect(checkedBoxes(openPage(storage))).toBe(1);
    expect(JSON.parse(storage.map.get(CONSENT_KEY)!)).toEqual({ service: { version: CONSENT_VERSIONS.service, at: "2026-10-14T00:00:00.000Z" } });
  });

  it("철회해 저장하면 다시 비어 있다", () => {
    const storage = memoryStorage();
    saveConsent({ service: true, health: true }, new Date(), storage);
    saveConsent({ service: false, health: false }, new Date(), storage);
    expect(storage.map.get(CONSENT_KEY)).toBe("{}");
    expect(checkedBoxes(openPage(storage))).toBe(0);
  });
});
