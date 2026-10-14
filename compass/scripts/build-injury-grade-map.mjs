// data/rules/injury-grade-map.json을 만든다.
// 약관 PDF에 실린 「자동차손해배상보장법 시행령 [별표 1]」의 상해 내용을 글자 그대로 뽑는다. 손으로 옮겨 적지 않는다.
// 실행: node scripts/build-injury-grade-map.mjs "<현대해상 개인용 약관 2025-11-26 PDF 경로>"
import { readFileSync, writeFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

const FIRST_PAGE = 87; // PDF 쪽 번호. 약관에 인쇄된 쪽 번호는 2가 작다(85쪽).
const LAST_PAGE = 92;
const doc = await getDocumentProxy(new Uint8Array(readFileSync(process.argv[2])));
const { text: pages } = await extractText(doc, { mergePages: false });

const items = [];
let grade = 0;
let current = null;
let done = false;
for (let page = FIRST_PAGE; page <= LAST_PAGE && !done; page++) {
  // 쪽 머리말, 표 머리말, 옆 탭의 세로 글자(한 글자짜리 줄)를 뺀다.
  const lines = pages[page - 1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => [...line].length > 1 && !/Hicar 개인용자동차보험 약관/.test(line) && line !== "상해급별 한도금액 상해 내용");
  for (let line of lines) {
    if (/^<붙임> 인체골격/.test(line)) {
      done = true;
      break;
    }
    if (grade === 0 && !/^1급/.test(line)) continue;
    const head = /^(\d{1,2})급\s*([\d,천백]+)?\s*(만원)?\s*(.*)$/.exec(line);
    if (head && (Number(head[1]) === grade || Number(head[1]) === grade + 1)) {
      grade = Number(head[1]);
      line = head[4];
      if (!line) continue;
    }
    line = line.replace(/^만원\s*/, "");
    if (!line) continue;
    const start = /^(\d{1,2})\.\s*(.*)$/.exec(line);
    if (start) {
      current = { grade, no: Number(start[1]), text: start[2], page: page - 2 };
      items.push(current);
    } else if (current) current.text += ` ${line}`;
  }
}

// 뽑은 결과가 온전한지 확인한다: 1~14급이 모두 있고 호 번호가 빠짐없이 이어져야 한다.
for (let g = 1; g <= 14; g++) {
  const numbers = items.filter((item) => item.grade === g).map((item) => item.no);
  if (numbers.length === 0 || numbers.some((no, index) => no !== index + 1)) throw new Error(`${g}급의 호 번호가 이어지지 않습니다: ${numbers.join(",")}`);
}

function surgery(text) {
  const plain = text.replace(/\s/g, "");
  if (/수술여부와상관없이/.test(plain)) return "any";
  if (/시행하지않|수술하지않/.test(plain)) return "without";
  if (/술(을|만)?시행한|수술한|수술적고정술/.test(plain)) return "with";
  return "any";
}

const map = {
  id: "injury-grade-map",
  version: "2025-11-26",
  title: "상해급수(1~14급) 후보 찾기용 상해 구분표",
  source: {
    law: "자동차손해배상보장법 시행령 [별표 1] 상해의 구분과 책임보험금의 한도금액(제3조제1항제2호 관련) 1. 상해 구분별 한도금액",
    document: "현대해상 Hicar 개인용자동차보험 약관 (2025-11-26 개정) <붙임>",
    pages: "85~90쪽",
    guidelines: "같은 별표의 2. 영역별 세부지침(91~92쪽)은 이 파일에 옮기지 않았다. 병급, 보존적 치료 시 하향 등으로 급수가 달라질 수 있다.",
  },
  // 약관 개정일이다. 별표 자체의 시행일은 법령에서 따로 확인해야 한다.
  effectiveFrom: "2025-11-26",
  effectiveFromStatus: "needs_check",
  items: items.map((item) => ({
    id: `g${item.grade}-${item.no}`,
    grade: item.grade,
    no: item.no,
    text: item.text.replace(/시 행한/g, "시행한").replace(/\s+/g, " ").trim(),
    basis: `자동차손해배상보장법 시행령 별표 1, ${item.grade}급 ${item.no}호`,
    page: item.page,
    surgery: surgery(item.text),
    catchAll: /^그 밖에/.test(item.text),
    // 약관 PDF에서 글자를 그대로 뽑았다. 사람이 한 줄씩 대조하지는 않았다.
    status: "confirmed",
  })),
  matching: {
    status: "needs_check",
    note: "진단서의 낱말과 별표의 낱말을 잇기 위한 검색 보조 자료다. 약관·법령의 문구가 아니며 급수를 정하지 않는다.",
    // 진단서에 흔한 한자어·줄임말 → 별표에 쓰인 낱말. 긴 낱말부터 찾는다.
    synonyms: {
      추간판탈출증: ["추간판탈출증"], 추간판탈출: ["추간판탈출증"], 디스크: ["추간판탈출증"], 추간판: ["추간판탈출증"],
      외상후스트레스: ["스트레스장애"], 스트레스장애: ["스트레스장애"],
      경막하출혈: ["뇌손상"], 경막외출혈: ["뇌손상"], 지주막하출혈: ["뇌손상"], 거미막하출혈: ["뇌손상"], 뇌출혈: ["뇌손상"], 뇌좌상: ["뇌손상"], 뇌타박상: ["뇌손상"], 두개내출혈: ["뇌손상"],
      경추: ["목뼈", "척추"], 경부: ["목뼈", "척추"], 요추: ["척추"], 요부: ["척추"], 흉추: ["척추"], 허리: ["척추"], 척추: ["척추"], 목뼈: ["목뼈", "척추"],
      대퇴골: ["넓적다리뼈", "팔다리"], 대퇴: ["넓적다리", "팔다리"], 넓적다리뼈: ["넓적다리뼈", "팔다리"],
      경골: ["정강이뼈", "팔다리"], 정강이뼈: ["정강이뼈", "팔다리"], 비골: ["코뼈", "종아리뼈"], 종아리뼈: ["종아리뼈", "팔다리"],
      요골: ["노뼈", "팔다리"], 척골: ["자뼈", "팔다리"], 상완골: ["위팔뼈", "팔다리"], 상완: ["위팔", "팔다리"], 전완: ["아래팔", "팔다리"],
      늑골: ["갈비뼈"], 흉골: ["복장뼈"], 슬개골: ["무릎뼈", "팔다리"], 견갑골: ["어깨뼈"], 골반골: ["골반"], 천골: ["엉치뼈", "골반"], 미골: ["꼬리뼈", "골반"],
      중수골: ["손허리뼈", "팔다리"], 중족골: ["발허리뼈", "팔다리"], 족지골: ["발가락", "손발가락", "팔다리"], 수지골: ["손가락", "손발가락", "팔다리"],
      거골: ["목말뼈", "발목", "팔다리"], 종골: ["발꿈치뼈", "발목", "팔다리"], 주상골: ["손배뼈", "손목", "팔다리"], 두개골: ["머리뼈"],
      견관절: ["어깨관절", "팔다리"], 주관절: ["팔꿈치", "팔다리"], 완관절: ["손목", "팔다리"], 수관절: ["손목", "팔다리"], 고관절: ["엉덩관절", "팔다리"], 슬관절: ["무릎", "팔다리"], 족관절: ["발목", "팔다리"],
      손가락: ["손가락", "손발가락", "팔다리"], 발가락: ["발가락", "손발가락", "팔다리"], 수지: ["손가락", "손발가락", "팔다리"], 족지: ["발가락", "손발가락", "팔다리"],
      손목: ["손목", "팔다리"], 발목: ["발목", "팔다리"], 무릎: ["무릎", "팔다리"], 어깨: ["어깨관절", "어깨뼈", "팔다리"], 팔꿈치: ["팔꿈치", "팔다리"],
      안면부: ["얼굴"], 안면: ["얼굴"], 얼굴: ["얼굴"], 코뼈: ["코뼈", "얼굴"],
      전방십자인대: ["십자인대", "무릎", "팔다리"], 후방십자인대: ["십자인대", "무릎", "팔다리"], 십자인대: ["십자인대", "무릎", "팔다리"],
      반월상연골: ["반월상", "무릎", "팔다리"], 반월판: ["반월상", "무릎", "팔다리"], 아킬레스건: ["아킬레스건", "팔다리"],
      열상: ["찢김상처"], 열창: ["찢김상처"], 타박상: ["타박"], 좌상: ["타박"], 긴장: ["염좌"],
      다리: ["팔다리"], 하지: ["팔다리"], 상지: ["팔다리"], 손등: ["팔다리"], 손바닥: ["팔다리"], 발등: ["팔다리"], 발바닥: ["팔다리"], 팔뚝: ["팔다리"], 사지: ["팔다리"],
      // 한 글자 낱말(손, 발, 팔, 목)은 "다발성", "목말뼈" 같은 말에 잘못 걸려서 넣지 않는다.
    },
    bodyParts: [
      "머리뼈", "얼굴", "안구", "안와", "각막", "결막", "고막", "코뼈", "턱뼈", "목뼈", "척추", "척주", "척수", "추체", "갈비뼈", "복장뼈", "흉부", "심장", "복부",
      "내부장기", "신장", "방광", "요도", "골반", "비구", "엉치뼈", "꼬리뼈", "쇄골", "빗장뼈", "어깨뼈", "어깨관절", "회전근개", "상완신경총", "위팔뼈", "위팔", "팔꿈치",
      "아래팔", "노뼈", "자뼈", "손목", "손배뼈", "손허리뼈", "손발가락", "손가락", "엉덩관절", "넓적다리뼈", "넓적다리", "무릎뼈", "무릎", "십자인대", "측부인대", "반월상",
      "정강이뼈", "종아리뼈", "발목", "목말뼈", "발꿈치뼈", "발허리뼈", "발가락", "아킬레스건", "힘줄", "근육", "혈관", "팔다리", "연부조직",
    ],
    injuryTypes: [
      "추간판탈출증", "스트레스장애", "뇌손상", "뇌진탕", "치과보철", "찢김상처", "골절", "탈구", "염좌", "타박", "파열", "절단", "화상", "혈흉", "기흉", "혈관절증", "손상",
    ],
  },
};
writeFileSync(new URL("../data/rules/injury-grade-map.json", import.meta.url), `${JSON.stringify(map, null, 2)}\n`);
console.log("항목", map.items.length, "개를 썼습니다.");
