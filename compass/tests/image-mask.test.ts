import { describe, expect, it } from "vitest";
import { findMaskBoxes, type OcrLine } from "@/lib/privacy/image-mask";
import { findSensitive, redact } from "@/lib/privacy/redact";

// 사진 속 개인정보 자리 찾기(lib/privacy/image-mask.ts). 줄은 tests/fixtures/policy-sample.jpg(가상 값)를
// tesseract.js(kor)로 읽은 실제 결과를 옮겼다. 단어 네모는 줄 번호·단어 순서로 지어낸 좌표다.

const SAMPLE = [
  "자 | 동 | 차 | 보험 | 가 | 입 | 증명서 | (가상 | 샘플)",
  "보 | 험 | 회사: | 가 | 상 | 화 | 재 | 해 | 상 | 보 | 험",
  "상품: | 가상 | 개인용 | 자 | 동 | 차 | 보험",
  "증 | 권 | 번호: | 가 | 상 | -2026-000123",
  "보 | 험 | 기 | 간 | : | 2026.01.01~ | 2027.01.01",
  "계약자: | 홍길동",
  "피보험자: | 홍길동",
  "주민등록번호. | 800505-1234567",
  "차 | 량 | 번호: | 12 | 가 | 3456",
  "차종: | 가 | 상 | 세단 | 2.0",
  "운전자 | 범위: | 부 | 부 | 한정",
  "연령 | 한정: | 만 | 30 | 세 | 이상",
  "담보 | / | 가 | 입 | 금액 | / | 자 | 기 | 부담금",
  "대 | 인 | 배 | 상 | ㅣ | | | 자 | 배 | 법 | 시 | 행 | 령 | 에서 | 정한 | 금액",
  "대 | 물 | 배상 | | | 1 | 사 | 고당 | 5 | 억 | 원",
  "자 | 동 | 차 | 상해 | | | 사 | 망 | - | 후 | 유 | 장 | 애 | 2 | 억 | 원, | 부상 | 3 | 천 | 만원",
  "자 | 기 | 차 | 량 | 손해 | | | 2.500 | 만 | 원 | | | 자 | 기 | 부담금 | 손 | 해 | 액 | 의 | 20% | (최소 | 20 | 만 | 원, | 최대 | 50 | 만 | 원)",
  "ㆍ | 긴 | 급 | 출 | 동 | 서비스 | 특약",
];

/** "a | b | c" 꼴의 줄을 단어 네모가 있는 줄로 바꾼다. 단어 i는 x = i*100 ~ i*100+90, 줄 n은 y = n*50 ~ n*50+30 */
function toLines(rows: string[]): OcrLine[] {
  return rows.map((row, n) => ({
    words: row.split(" | ").map((text, i) => ({ text, bbox: { x0: i * 100, y0: n * 50, x1: i * 100 + 90, y1: n * 50 + 30 } })),
  }));
}

/** 네모가 덮는 단어 글자를 줄별로 모은다. */
function covered(rows: string[]) {
  const lines = toLines(rows);
  const boxes = findMaskBoxes(lines);
  return lines.map((line) =>
    line.words
      .filter((word) => boxes.some((box) => box.x0 <= word.bbox.x0 && box.x1 >= word.bbox.x1 && box.y0 <= word.bbox.y0 && box.y1 >= word.bbox.y1))
      .map((word) => word.text)
      .join(""),
  );
}

describe("가상 증권 사진", () => {
  const result = covered(SAMPLE);
  const line = (start: string) => result[SAMPLE.findIndex((row) => row.startsWith(start))];

  it("증권번호·이름·주민번호·차량번호 자리를 칠한다", () => {
    expect(line("증 | 권")).toBe("가상-2026-000123");
    expect(line("계약자")).toBe("홍길동");
    expect(line("피보험자")).toBe("홍길동");
    expect(line("주민등록번호")).toBe("800505-1234567");
    expect(line("차 | 량")).toBe("12가3456");
  });

  it("항목 이름은 남긴다", () => {
    expect(line("계약자")).not.toContain("계약자");
    expect(line("주민등록번호")).not.toContain("주민등록번호");
  });

  it("보험사·상품·기간·차종·운전자 범위·담보·금액은 칠하지 않는다", () => {
    const keep = SAMPLE.filter((row) => !/^(증 \| 권|계약자|피보험자|주민등록번호|차 \| 량)/.test(row));
    for (const row of keep) expect(result[SAMPLE.indexOf(row)], row).toBe("");
  });
});

describe("줄 첫머리 항목 이름", () => {
  it("인식이 틀려 꼴이 맞지 않아도 그 줄의 값을 칠한다", () => {
    expect(covered(["주 | 민 | 번호: | 8OO5O5-l234567"])[0]).toBe("8OO5O5-l234567");
    expect(covered(["연 | 락 | 처 | 010-l234-S678"])[0]).toBe("010-l234-S678");
  });

  it("이름 항목 뒤가 운전자 범위 같은 말이면 칠하지 않는다", () => {
    expect(covered(["기명피보험자 | 1인 | 한정"])[0]).toBe("");
    expect(covered(["피보험자 | 자기신체사고"])[0]).toBe("");
  });

  it("값이 없으면 칠하지 않는다", () => {
    expect(covered(["계약자:"])[0]).toBe("");
  });
});

describe("줄 가운데의 꼴", () => {
  it("항목 이름 없이 섞인 전화번호도 칠한다", () => {
    expect(covered(["긴급출동 | 문의 | 010-1234-5678 | (24시간)"])[0]).toBe("010-1234-5678");
  });

  it("보험사 대표번호는 남긴다", () => {
    expect(covered(["고객센터 | 1588-5656"])[0]).toBe("");
  });

  it("떨어진 두 자리는 따로 칠한다", () => {
    const boxes = findMaskBoxes(toLines(["문의 | 010-1234-5678 | 또는 | kim@example.com"]));
    expect(boxes).toHaveLength(2);
  });

  it("앞 단어(항목 이름)와의 사이를 빈틈없이 채우되 그 단어를 다 덮지는 않는다", () => {
    const gapped: OcrLine[] = [{ words: [{ text: "계약자:", bbox: { x0: 0, y0: 0, x1: 90, y1: 30 } }, { text: "홍길동", bbox: { x0: 200, y0: 0, x1: 290, y1: 30 } }] }];
    const [box] = findMaskBoxes(gapped);
    expect(box!.x0).toBeLessThanOrEqual(91);
    expect(box!.x0).toBeGreaterThan(0);
  });

  it("네모는 글자보다 조금 넓다", () => {
    const [box] = findMaskBoxes(toLines(["010-1234-5678"]));
    expect(box!.x0).toBeLessThanOrEqual(0);
    expect(box!.x1).toBeGreaterThan(90);
    expect(box!.y1).toBeGreaterThan(30);
  });
});

describe("findSensitive", () => {
  it("redact가 가리는 것과 같은 수를 찾는다", () => {
    const text = "계약자 홍길동 / 주민 800505-1234567 / 010-1234-5678 / 12가3456 / kim@example.com";
    expect(findSensitive(text)).toHaveLength(redact(text).count);
  });

  it("항목 이름이 붙은 값은 값 자리만 돌려준다", () => {
    const text = "계약자: 홍길동";
    const [span] = findSensitive(text);
    expect(text.slice(span!.start, span!.end)).toBe("홍길동");
  });

  it("금액·날짜는 찾지 않는다", () => {
    expect(findSensitive("대물배상 30,000,000원 / 2026-01-01 ~ 2027-01-01 / 과실 30%")).toEqual([]);
  });
});
