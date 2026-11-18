// 라운드 9: 약관 원문 검색용 글자 파일을 만든다(앱에 함께 배포한다).
// data/raw/policies/의 약관 PDF 4개에서 쪽마다 글자를 뽑아 lib/terms/data.json에 쓴다. 쪽 번호는 인쇄 쪽(PDF 쪽 − 2, 4개 약관 모두 같음).
// 실행: node scripts/build-terms.mjs (PDF가 바뀔 때만 다시 실행한다)
import { readFileSync, writeFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const PRODUCTS = { personal: "개인용", business: "업무용", commercial: "영업용", motorcycle: "이륜차" };
/** 인쇄 쪽 = PDF 쪽 − 2 (4개 PDF 머리글의 쪽 번호로 확인) */
const PRINT_OFFSET = 2;

async function pages(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let text = "";
    let lastY = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += "\n";
      text += item.str;
      lastY = y;
    }
    const lines = text
      .normalize("NFKC")
      .replace(/\u0000/g, "")
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      // 쪽 옆의 세로 색인(글자 하나씩 한 줄)은 버린다
      .filter((l) => l.length > 1);
    const page = i - PRINT_OFFSET;
    if (page >= 1 && lines.length) out.push({ p: page, t: lines.join("\n") });
  }
  return out;
}

const data = {};
for (const [key, name] of Object.entries(PRODUCTS)) {
  data[key] = { name, pages: await pages(new URL(`../../data/raw/policies/${name} 약관.pdf`, import.meta.url)) };
  console.log(name, data[key].pages.length, "쪽");
}
writeFileSync(new URL("../lib/terms/data.json", import.meta.url), JSON.stringify(data));
