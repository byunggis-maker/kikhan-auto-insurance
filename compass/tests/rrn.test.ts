import { describe, expect, it } from "vitest";
import { birthFromResident, findResidentNumber, maskDeep, maskResidentNumbers } from "@/lib/privacy/rrn";

// 여기 나오는 번호는 모두 지어낸 것이다.
describe("주민등록번호 처리", () => {
  it("뒷자리를 가리고 앞 6자리만 남긴다", () => {
    expect(maskResidentNumbers("주민등록번호 800505-1234567 입니다")).toBe("주민등록번호 800505-****** 입니다");
    expect(maskResidentNumbers("800505 - 2234567")).toBe("800505-******");
    expect(maskResidentNumbers("8005051234567")).toBe("800505-******");
    expect(maskResidentNumbers("800505 1234567")).toBe("800505-******");
  });

  it("이미 일부가 가려진 번호도 같은 꼴로 맞춘다", () => {
    expect(maskResidentNumbers("800505-1******")).toBe("800505-******");
    expect(maskResidentNumbers("800505-1●●●●●●")).toBe("800505-******");
  });

  it("한 글에 여러 개가 있어도 모두 가린다", () => {
    const masked = maskResidentNumbers("계약자 800505-1234567, 피보험자 020304-4123456");
    expect(masked).not.toMatch(/\d{6}-\d{7}/);
    expect(masked).toBe("계약자 800505-******, 피보험자 020304-******");
  });

  it("주민등록번호가 아닌 숫자는 건드리지 않는다", () => {
    for (const text of ["증권번호 2026-0001234567", "전화 010-1234-5678", "가입금액 2,500만원", "보험기간 2026.01.01 ~ 2027.01.01", "증권번호 9912345678901234"]) {
      expect(maskResidentNumbers(text)).toBe(text);
    }
  });

  it("앞 6자리와 뒷자리 첫 숫자로 생년월일과 성별을 만든다", () => {
    expect(birthFromResident("800505", "1")).toEqual({ birthDate: "1980-05-05", gender: "M" });
    expect(birthFromResident("800505", "2")).toEqual({ birthDate: "1980-05-05", gender: "F" });
    expect(birthFromResident("020304", "3")).toEqual({ birthDate: "2002-03-04", gender: "M" });
    expect(birthFromResident("020304", "4")).toEqual({ birthDate: "2002-03-04", gender: "F" });
    expect(birthFromResident("850101", "5")).toEqual({ birthDate: "1985-01-01", gender: "M" });
    expect(birthFromResident("050101", "8")).toEqual({ birthDate: "2005-01-01", gender: "F" });
  });

  it("달력에 없는 날짜나 모자란 값이면 만들지 않는다", () => {
    expect(birthFromResident("801340", "1")).toBeNull();
    expect(birthFromResident("010229", "3")).toBeNull();
    expect(birthFromResident("800505", null)).toBeNull();
    expect(birthFromResident("800505", "9")).toBeNull();
    expect(birthFromResident("80050", "1")).toBeNull();
  });

  it("글에서 번호를 찾아 필요한 부분만 돌려준다", () => {
    expect(findResidentNumber("주민등록번호 800505-1234567")).toEqual({ front6: "800505", backFirst: "1" });
    expect(findResidentNumber("번호 없음")).toBeNull();
  });

  it("객체 안의 모든 문자열을 가린다", () => {
    const masked = maskDeep({ a: "800505-1234567", list: ["x 020304-4123456"], deep: { b: "8005051234567", n: 3, none: null } });
    expect(JSON.stringify(masked)).not.toMatch(/1234567|4123456/);
    expect(masked.deep).toEqual({ b: "800505-******", n: 3, none: null });
  });
});
