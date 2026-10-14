import { describe, expect, it } from "vitest";
import { suggestInjuryGrades } from "@/lib/engine/injury-grade";
import { injuryGradeMap as map } from "@/lib/rules/injury-grade-map";

const suggest = (diagnosis: string, surgery: boolean | null = null) => suggestInjuryGrades({ diagnosis, surgery, hospitalDays: null }, map);
const ids = (diagnosis: string, surgery: boolean | null = null) => suggest(diagnosis, surgery).candidates.map((c) => c.itemId);

describe("상해 구분표(규칙 데이터)", () => {
  it("1급부터 14급까지 모두 있고 호 번호가 빠짐없이 이어진다", () => {
    for (let grade = 1; grade <= 14; grade++) {
      const numbers = map.items.filter((item) => item.grade === grade).map((item) => item.no);
      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    }
  });

  it("항목마다 근거 조항과 확인 상태가 있고, 급마다 포괄 항목으로 끝난다", () => {
    for (const item of map.items) {
      expect(item.basis).toBe(`자동차손해배상보장법 시행령 별표 1, ${item.grade}급 ${item.no}호`);
      expect(["confirmed", "needs_check"]).toContain(item.status);
    }
    for (let grade = 1; grade <= 14; grade++) {
      const last = map.items.filter((item) => item.grade === grade).at(-1)!;
      expect(last.text).toBe(`그 밖에 ${grade}급에 해당한다고 인정되는 상해`);
      expect(last.catchAll).toBe(true);
    }
  });

  it("약관 원문과 같은 문구를 담고 있다(표본)", () => {
    const text = (id: string) => map.items.find((item) => item.id === id)?.text;
    expect(text("g12-3")).toBe("척추 염좌");
    expect(text("g11-1")).toBe("뇌진탕");
    expect(text("g9-6")).toBe("추간판 탈출증");
    expect(text("g14-3")).toBe("팔다리의 단순 타박");
    expect(text("g7-5")).toBe("쇄골(빗장뼈) 골절");
  });

  it("검색 보조 낱말은 확인이 필요한 자료로 표시되어 있다", () => {
    expect(map.matching.status).toBe("needs_check");
    expect(map.effectiveFromStatus).toBe("needs_check");
  });
});

describe("상해급수 후보 찾기", () => {
  it("흔한 진단명에서 맞는 항목을 첫 후보로 낸다", () => {
    expect(ids("경추 염좌")[0]).toBe("g12-3");
    expect(ids("요추의 염좌 및 긴장")[0]).toBe("g12-3");
    expect(ids("뇌진탕")[0]).toBe("g11-1");
    expect(ids("요추 추간판 탈출증")[0]).toBe("g9-6");
    expect(ids("쇄골 골절")[0]).toBe("g7-5");
    expect(ids("슬개골 골절")[0]).toBe("g5-20");
    expect(ids("무릎 타박상")).toContain("g14-3");
    expect(ids("손목 염좌")).toContain("g12-4");
    expect(ids("손가락 염좌")[0]).toBe("g14-2");
  });

  it("후보마다 급수, 별표 문구, 근거 조항, 이유가 있다", () => {
    const [first] = suggest("경추 염좌").candidates;
    expect(first).toMatchObject({ grade: 12, text: "척추 염좌", basis: "자동차손해배상보장법 시행령 별표 1, 12급 3호", page: 90, status: "confirmed" });
    expect(first.reason).toContain('"척추"');
    expect(first.reason).toContain('"염좌"');
  });

  it("수술 여부에 따라 맞지 않는 항목을 뺀다", () => {
    // 코뼈 골절: 수술하면 9급 1호, 수술하지 않으면 11급 2호
    expect(ids("코뼈 골절", true)).toContain("g9-1");
    expect(ids("코뼈 골절", true)).not.toContain("g11-2");
    expect(ids("코뼈 골절", false)).toContain("g11-2");
    expect(ids("코뼈 골절", false)).not.toContain("g9-1");
    // 수술 여부를 모르면 둘 다 보여 주고, 이유에 조건을 적는다.
    const unknown = suggest("코뼈 골절").candidates;
    expect(unknown.map((c) => c.itemId)).toEqual(expect.arrayContaining(["g9-1", "g11-2"]));
    expect(unknown.find((c) => c.itemId === "g9-1")?.reason).toContain("수술을 한 경우에만");
  });

  it("손목·발목 안의 '목'을 목뼈로 잘못 읽지 않는다", () => {
    expect(suggest("발목 염좌").recognized).not.toContain("목뼈");
    expect(ids("발목 염좌")).not.toContain("g12-3");
  });

  it("'분쇄 골절' 속의 '쇄골'처럼 낱말이 이어져 생긴 가짜 낱말을 잡지 않는다", () => {
    expect(suggest("대퇴골 분쇄 골절").recognized).not.toContain("쇄골");
    expect(ids("쇄골 골절")).not.toContain("g2-11");
  });

  it("알아볼 수 없는 진단명이면 후보를 내지 않는다", () => {
    expect(suggest("").candidates).toEqual([]);
    expect(suggest("상세불명").candidates).toEqual([]);
    expect(suggest("감기").candidates).toEqual([]);
  });

  it("포괄 항목은 후보로 내지 않고, 후보 수를 제한한다", () => {
    const all = suggest("골절").candidates;
    expect(all.length).toBeLessThanOrEqual(6);
    expect(all.every((c) => !c.text.startsWith("그 밖에"))).toBe(true);
  });

  it("입원일수는 후보에 영향을 주지 않는다(별표에 기준이 없다)", () => {
    const a = suggestInjuryGrades({ diagnosis: "경추 염좌", surgery: null, hospitalDays: 0 }, map);
    const b = suggestInjuryGrades({ diagnosis: "경추 염좌", surgery: null, hospitalDays: 60 }, map);
    expect(a).toEqual(b);
  });
});
