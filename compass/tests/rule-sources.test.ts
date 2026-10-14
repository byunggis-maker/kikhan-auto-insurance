import { describe, expect, it } from "vitest";
import dailyWage from "@/data/rules/daily-wage.json";
import { dailyWageRuleItems } from "@/lib/rules/daily-wage";
import productCheck from "@/data/rules/product-check.json";
import productRevisions from "@/data/rules/product-revisions.json";
import { personRuleItems, rulesFor } from "@/lib/rules/person-rules";
import { dailyWageFileSchema, productRevisionsSchema, type DailyWageFile } from "@/lib/schemas/rules";

// 규칙 값의 출처 표기와, 사람이 넣는 일용근로자 임금 항목.

describe("출처 표기", () => {
  const fromPolicy = personRuleItems.filter((item) => item.basis.sourceId === "hi-personal-20251126" && item.status === "confirmed");

  it("현대해상 개인용 약관에서 읽은 confirmed 항목(사람 담보 176개 + 차량·특약 94개)은 모두 출처와 쪽 번호가 있다", () => {
    expect(fromPolicy).toHaveLength(270);
    for (const item of fromPolicy) expect(item.basis.source, item.id).toMatch(new RegExp(`^현대해상 개인용 약관 2025-11-26 개정 (별표|본문) ${item.basis.page}쪽$`));
  });

  it("별표가 아닌 곳(약관 본문·특별약관·안내 쪽)에서 읽은 항목은 '본문'으로 구분한다", () => {
    const body = fromPolicy.filter((item) => item.basis.source.includes("개정 본문"));
    // 조항 문구(clause.*), 담보 구성(product.*), 특별약관(rider.*), 자기차량손해 제24조·안내 쪽(ownDamage.*), 대인배상Ⅰ 사망 한도
    for (const item of body) expect(/^(clause\.|product\.|rider\.|ownDamage\.)|^liability1\.death\.limit$/.test(item.id), item.id).toBe(true);
    expect(fromPolicy.filter((item) => item.id.startsWith("property.")).every((item) => item.basis.source.includes("개정 별표"))).toBe(true);
  });
});

describe("표준약관 원문 대조", () => {
  // docs/source/에 금융감독원 자동차보험 표준약관 PDF를 넣고 scripts/check-product-terms.mjs를 돌리면
  // data/rules/product-check.json에 "standard"가 생기고 이 테스트가 켜진다. 그때까지는 건너뛴다.
  const standard = (productCheck.products as Record<string, (typeof productCheck.products)["personal"] | undefined>).standard;

  it.skipIf(!standard)("표준약관에 있는 지급기준(별표와 보통약관 조항)이 규칙 값과 같다", () => {
    // 특별약관(법률비용·렌트비용·자동차상해)은 표준약관에 없으므로 대조에서 뺀다.
    const inStandard = (standard?.probes ?? []).filter((probe) => !/rider|auto_injury/.test(probe.ids));
    expect(inStandard.length).toBeGreaterThan(30);
    expect(inStandard.filter((probe) => !probe.same).map((probe) => probe.name)).toEqual([]);
  });
});

describe("일용근로자 임금", () => {
  const file = dailyWageFileSchema.parse(dailyWage);
  const entry = (change: Partial<DailyWageFile["entries"][number]>) => ({ value: null, source: null, publishedOn: null, effectiveFrom: null, effectiveTo: null, ...change });

  it("값을 넣지 않은 동안에는 값이 없는 자리 항목만 있다", () => {
    const empty = dailyWageRuleItems({ ...file, entries: [entry({})] });
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({ id: "dailyWage.amount", value: null, status: "needs_check" });
  });

  it("값·출처·공표일·적용 시작일을 넣으면 그 기간의 규칙 항목이 된다 (시험용 가정값)", () => {
    const items = dailyWageRuleItems({
      ...file,
      entries: [entry({ value: 150_000, source: "시험용 가상 공표 자료", publishedOn: "2026-01-02", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" }), entry({})],
    });
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ id: "dailyWage.amount", value: 150_000, status: "confirmed", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" });
    expect(items[1].basis.source).toBe("시험용 가상 공표 자료 (공표일 2026-01-02)");
  });

  it("값만 넣고 출처·공표일·적용 시작일을 비우면 스키마 검증에서 실패한다", () => {
    expect(dailyWageFileSchema.safeParse({ ...file, entries: [entry({ value: 150_000 })] }).success).toBe(false);
    expect(dailyWageFileSchema.safeParse({ ...file, entries: [entry({ value: 150_000, source: "시험용 가상 공표 자료", publishedOn: "2026-01-02" })] }).success).toBe(false);
  });
});

describe("업무용·영업용·이륜차 약관 대조", () => {
  const notSame = (product: "business" | "commercial" | "motorcycle") => productCheck.products[product].probes.filter((probe) => !probe.same).map((probe) => probe.name);

  it("대조 결과: 업무용은 모두 같고, 영업용·이륜차는 약관에 없는 것만 다르다", () => {
    expect(productCheck.products.personal.probes.every((probe) => probe.same)).toBe(true);
    expect(notSame("business")).toEqual([]);
    // 영업용: 무보험자동차상해는 특별약관이고 렌트비용지원 특별약관이 없다.
    expect(notSame("commercial")).toEqual(["무보험자동차상해 지급보험금 조항", "렌트비용 1일 한도", "렌트비용 대차하지 않는 경우", "렌트비용 인정기간"]);
    // 이륜차: 벌금비용의 어린이 보호구역 단서와 렌트비용지원 특별약관이 없다.
    expect(notSame("motorcycle")).toEqual(["벌금비용 한도(어린이 보호구역)", "렌트비용 1일 한도", "렌트비용 대차하지 않는 경우", "렌트비용 인정기간"]);
    expect(productCheck.products.commercial.legalPlans.map((plan) => plan.name)).toEqual(["기본형", "고보장형"]);
    expect(productCheck.products.motorcycle.legalPlans.map((plan) => plan.name)).toEqual(["지급보험금"]);
  });

  it("같은 값임을 확인한 항목에는 그 약관의 쪽 번호가 붙고, 개정일이 없는 동안은 '약관 확인 필요'다", () => {
    const item = rulesFor("business").find((rule) => rule.id === "solatium.injury.grade7");
    expect(item).toMatchObject({ value: 400_000, status: "needs_check", effectiveFrom: "2025-11-26" });
    expect(item?.basis.source).toBe("현대해상 업무용 약관 (개정일 미확인) 36쪽 (개인용 약관 77쪽과 같은 값)");
    expect(item?.note).toContain("개정일을 확인하지 못해");
    // 대조하지 않은 항목(약관 본문이 아닌 안내 쪽에서 읽은 값 등)
    const unchecked = rulesFor("business").find((rule) => rule.id === "ownDamage.deductible.options");
    expect(unchecked?.status).toBe("needs_check");
    expect(unchecked?.note).toContain("대조하지 않았거나");
    // 개인용 규칙은 바뀌지 않는다.
    expect(rulesFor("personal")).toBe(personRuleItems);
  });

  it("개정일과 확인 근거를 넣으면 확인한 항목이 그 날짜부터 적용되는 확정 값이 된다 (시험용 가정 날짜)", () => {
    const revisions = productRevisionsSchema.parse({ ...productRevisions, products: { ...productRevisions.products, business: { revisedOn: "2025-10-01", confirmedBy: "시험용 가정" } } });
    const rules = rulesFor("business", revisions);
    const item = rules.find((rule) => rule.id === "solatium.injury.grade7");
    expect(item).toMatchObject({ status: "confirmed", effectiveFrom: "2025-10-01" });
    expect(item?.basis.source).toBe("현대해상 업무용 약관 2025-10-01 개정 36쪽 (개인용 약관 77쪽과 같은 값)");
    // 개인용에서도 확인 필요였던 항목과, 대조하지 않은 항목은 그대로 확인 필요다.
    expect(rules.find((rule) => rule.id === "rounding.won")?.status).toBe("needs_check");
    expect(rules.find((rule) => rule.id === "ownDamage.deductible.options")?.status).toBe("needs_check");
    expect(rules.find((rule) => rule.id === "product.riders")).toMatchObject({ status: "confirmed", effectiveFrom: "2025-10-01" });
    // 근거 없이 날짜만 넣을 수는 없다.
    expect(productRevisionsSchema.safeParse({ ...productRevisions, products: { business: { revisedOn: "2025-10-01", confirmedBy: null } } }).success).toBe(false);
  });
});
