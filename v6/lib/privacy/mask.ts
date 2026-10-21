// MASTER.md 9장·라운드 6 지시 5: 검토서·엑셀·PDF 어디에도 주민번호·증권번호·차량번호·전화번호가 들어가지 않게 한다.
// 입력 모델에는 이런 칸이 없다. 다만 사용자가 자유 입력란(사고 경위·장소·보험사·이름·서류 근거)에 직접 적을 수 있으므로
// 내보내기 전에 모든 글자를 이 함수로 가린다. 가린 자리는 "●"로 채워 길이만 남긴다.

const RULES: { name: string; pattern: RegExp }[] = [
  // 주민등록번호·외국인등록번호: 앞 6자리 + 뒤 7자리(하이픈·공백 있음/없음). 더 긴 숫자 묶음의 일부나 줄바꿈 너머는 잡지 않는다
  { name: "주민번호", pattern: /(?<!\d)\d{6} ?-? ?[1-8]\d{6}(?!\d)/g },
  // 휴대전화·지역번호 전화번호
  { name: "전화번호", pattern: /0(?:1[016789]|2|[3-6][1-5]|70)[-.\s]?\d{3,4}[-.\s]?\d{4}/g },
  // 차량번호: (지역) 2~3자리 숫자 + 한글 한 글자 + 4자리 숫자 — 예) 12가3456, 123나4567, 서울12가3456
  { name: "차량번호", pattern: /(?:[가-힣]{2})?\d{2,3}\s?[가-힣]\s?\d{4}/g },
  // 증권번호 등 긴 번호: 하이픈이 섞여도 숫자가 10자리 이상인 묶음
  { name: "증권번호", pattern: /\d(?:[\d-]{8,})\d/g },
];

export function maskText(text: string): string {
  let out = text;
  for (const rule of RULES) out = out.replace(rule.pattern, (match) => (rule.name === "증권번호" && match.replace(/\D/g, "").length < 10 ? match : match.replace(/[^\s-]/g, "●")));
  return out;
}

/** 무엇이 가려졌는지(테스트·점검용) */
export function findSensitive(text: string): string[] {
  const found: string[] = [];
  for (const rule of RULES) for (const match of text.matchAll(rule.pattern)) if (rule.name !== "증권번호" || match[0].replace(/\D/g, "").length >= 10) found.push(rule.name);
  return found;
}
