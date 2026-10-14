import { findSensitive } from "@/lib/privacy/redact";

// 사진 속 개인정보 자리 찾기. 브라우저의 글자 인식(tesseract.js) 결과를 받아 검게 칠할 네모를 돌려준다.
// 글자 인식은 기기 안에서만 하고, 이 파일은 인식 결과만 다루는 순수 함수다(사진·글을 어디에도 보내거나 남기지 않는다).
// 한국어 인식은 한 글자씩 끊어 나오는 일이 많아("차 | 량 | 번호:"), 줄마다 띄어쓰기를 없앤 글에서 찾는다.
// 찾는 방법은 두 가지다.
//   1. lib/privacy/redact.ts와 같은 규칙(주민번호·전화·차량번호·증권번호 꼴, "계약자: ○○○" 같은 항목 이름 뒤의 값)
//   2. 줄 첫머리가 신원 항목 이름이면 그 줄의 나머지 전체(인식이 조금 틀려 꼴이 맞지 않아도 가리기 위해)
// 자동으로 찾은 자리는 사용자가 확인하고 고친다. 빠진 곳이 있을 수 있으므로 화면에서 직접 칠하게 안내한다.

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type OcrWord = { text: string; bbox: Box };
export type OcrLine = { words: OcrWord[] };

// 줄 첫머리에 오면 그 줄의 나머지를 모두 가리는 항목 이름(띄어쓰기 없이 비교)
const LINE_LABELS = [
  "주민등록번호",
  "주민번호",
  "외국인등록번호",
  "생년월일",
  "증권번호",
  "계약번호",
  "증서번호",
  "차량번호",
  "자동차등록번호",
  "등록번호",
  "보험계약자",
  "계약자",
  "기명피보험자",
  "피보험자",
  "성명",
  "이름",
  "예금주",
  "주소",
  "연락처",
  "전화번호",
  "휴대전화",
  "휴대폰",
  "이메일",
  "계좌번호",
  "카드번호",
];
// 이름 항목 뒤에 와도 사람 이름이 아닌 말(운전자 범위 등). redact.ts의 NOT_A_NAME과 같은 뜻
const NAME_LINE_LABELS = new Set(["보험계약자", "계약자", "기명피보험자", "피보험자", "성명", "이름", "예금주"]);
const NOT_A_NAME = /(사고|상해|배상|담보|보험|특약|한정|가족|부부|본인|누구|동일|기준|범위|이상|이하|연령|운전|해당|없음|미가입|가입|정보|확인|자동차|차량|소유|명의|1인)/;

// 인식이 흔히 틀리는 구분 기호를 맞춘다(마침표·세미콜론으로 읽힌 쌍점 등). 길이는 바꾸지 않는다.
const tidy = (text: string) => text.replace(/[;.](?=\s*$)/, ":");

type Joined = { text: string; owner: number[] };

/** 줄의 단어를 띄어쓰기 없이 잇고, 글자마다 어느 단어에서 왔는지 적는다. */
function join(line: OcrLine): Joined {
  let text = "";
  const owner: number[] = [];
  line.words.forEach((word, index) => {
    const part = tidy(word.text.replace(/\s+/g, ""));
    text += part;
    for (let i = 0; i < part.length; i++) owner.push(index);
  });
  return { text, owner };
}

function wordsInSpan(joined: Joined, start: number, end: number) {
  const words = new Set<number>();
  for (let i = start; i < end; i++) words.add(joined.owner[i]!);
  return words;
}

function lineLabelValue(joined: Joined): Set<number> | null {
  const label = LINE_LABELS.find((item) => joined.text.startsWith(item));
  if (!label) return null;
  const rest = joined.text.slice(label.length).replace(/^[:：.\s]+/, "");
  if (!rest) return null;
  if (NAME_LINE_LABELS.has(label) && NOT_A_NAME.test(rest)) return null;
  const start = joined.text.length - rest.length;
  // 항목 이름과 같은 단어에 붙은 값(예: "번호:800505-…")은 그 단어까지 가린다. 항목 이름만 든 단어는 남긴다.
  return wordsInSpan(joined, start, joined.text.length);
}

function union(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

/** 칠할 네모(그림 좌표). 가장자리가 비치지 않게 글자 높이에 비례해 조금 넓힌다. */
export function findMaskBoxes(lines: OcrLine[]): Box[] {
  const boxes: Box[] = [];
  for (const line of lines) {
    if (line.words.length === 0) continue;
    const joined = join(line);
    const hit = new Set<number>();
    for (const span of findSensitive(joined.text)) for (const word of wordsInSpan(joined, span.start, span.end)) hit.add(word);
    for (const word of lineLabelValue(joined) ?? []) hit.add(word);
    if (hit.size === 0) continue;
    // 한 줄에서 이어진 단어들은 한 네모로 묶는다.
    const sorted = [...hit].sort((a, b) => a - b);
    let run: number[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const box = union(run.map((index) => line.words[index]!.bbox));
      // 인식한 글자 네모는 실제 글자보다 좁게 잡히는 일이 있어(특히 첫 글자) 옆으로 더 넓히고,
      // 남겨 둘 앞뒤 단어(항목 이름 등)와의 사이도 채운다.
      const height = box.y1 - box.y0;
      const padX = Math.max(4, Math.round(height * 0.45));
      const padY = Math.max(2, Math.round(height * 0.25));
      const before = line.words[run[0]! - 1]?.bbox.x1;
      const after = line.words[run[run.length - 1]! + 1]?.bbox.x0;
      const x0 = before === undefined ? box.x0 - padX : Math.min(box.x0 - padX, before + 1);
      const x1 = after === undefined ? box.x1 + padX : Math.max(box.x1 + padX, after - 1);
      boxes.push({ x0: Math.max(0, x0), y0: Math.max(0, box.y0 - padY), x1, y1: box.y1 + padY });
      run = [];
    };
    for (const index of sorted) {
      if (run.length > 0 && index !== run[run.length - 1]! + 1) flush();
      run.push(index);
    }
    flush();
  }
  return boxes;
}
