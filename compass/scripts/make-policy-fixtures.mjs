// 테스트용 가짜 증권 샘플을 만든다(macOS 전용: Chrome과 sips를 쓴다).
// 내용은 모두 지어낸 것이다. 실제 사람·차량·증권 정보가 아니다.
// 실행: node scripts/make-policy-fixtures.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

const out = new URL("../tests/fixtures/", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "kac-fixtures-"));

const HEAD = [
  ["보험회사", "가상화재해상보험"],
  ["상품", "가상 개인용 자동차보험"],
  ["증권번호", "가상-2026-000123"],
  ["보험기간", "2026.01.01 ~ 2027.01.01"],
  ["계약자", "홍길동"],
  ["피보험자", "홍길동"],
  ["주민등록번호", "800505-1234567"],
  ["차량번호", "12가3456"],
  ["차종", "가상세단 2.0"],
  ["운전자 범위", "부부한정"],
  ["연령 한정", "만 30세 이상"],
];
const COVERAGES = [
  ["대인배상Ⅰ", "자배법 시행령에서 정한 금액", ""],
  ["대인배상Ⅱ", "무한", ""],
  ["대물배상", "1사고당 5억원", ""],
  ["자동차상해", "사망·후유장애 2억원, 부상 3천만원", ""],
  ["무보험자동차에 의한 상해", "1인당 2억원", ""],
  ["자기차량손해", "2,500만원", "손해액의 20% (최소 20만원, 최대 50만원)"],
];
const RIDERS = ["긴급출동서비스 특약", "블랙박스 장착 할인 특약"];
const TITLE = "자동차보험 가입증명서 (가상 샘플)";

// 1) 글자가 들어 있는 PDF: Chrome으로 HTML을 인쇄한다.
const html = `<!doctype html><meta charset="utf-8"><style>body{font-family:"Apple SD Gothic Neo",sans-serif;font-size:13pt;margin:40px}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #333;padding:6px 8px;text-align:left}</style>
<h1>${TITLE}</h1><table>${HEAD.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
<h2>담보</h2><table><tr><th>담보명</th><th>가입금액</th><th>자기부담금</th></tr>${COVERAGES.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>
<h2>특약</h2><ul>${RIDERS.map((r) => `<li>${r}</li>`).join("")}</ul>`;
const htmlPath = join(work, "policy.html");
writeFileSync(htmlPath, html);
execFileSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${out}policy-sample.pdf`, `file://${htmlPath}`,
], { stdio: "ignore" });

// 2) 사진 모양의 JPG: 같은 내용을 그림으로 그린다.
const canvas = createCanvas(1400, 1800);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, 1400, 1800);
ctx.fillStyle = "#111111";
ctx.font = "bold 52px 'Apple SD Gothic Neo'";
ctx.fillText(TITLE, 60, 110);
ctx.font = "36px 'Apple SD Gothic Neo'";
let y = 200;
for (const [k, v] of HEAD) {
  ctx.fillText(`${k}: ${v}`, 60, y);
  y += 60;
}
y += 30;
ctx.font = "bold 40px 'Apple SD Gothic Neo'";
ctx.fillText("담보 / 가입금액 / 자기부담금", 60, y);
ctx.font = "32px 'Apple SD Gothic Neo'";
for (const [name, limit, deductible] of COVERAGES) {
  y += 60;
  ctx.fillText(`${name} | ${limit}${deductible ? ` | 자기부담금 ${deductible}` : ""}`, 60, y);
}
y += 90;
ctx.font = "bold 40px 'Apple SD Gothic Neo'";
ctx.fillText("특약", 60, y);
ctx.font = "32px 'Apple SD Gothic Neo'";
for (const rider of RIDERS) {
  y += 60;
  ctx.fillText(`· ${rider}`, 60, y);
}
const jpg = `${out}policy-sample.jpg`;
await sharp(canvas.toBuffer("image/png")).jpeg({ quality: 80 }).toFile(jpg);

// 3) 아이폰 사진 형식(HEIC)과 4) 글자가 없는 스캔 PDF: macOS의 sips로 바꾼다.
execFileSync("sips", ["-s", "format", "heic", jpg, "--out", `${out}policy-sample.heic`], { stdio: "ignore" });
execFileSync("sips", ["-s", "format", "pdf", jpg, "--out", `${out}policy-scan.pdf`], { stdio: "ignore" });
console.log("만들었습니다:", out);

// 5) 비밀번호가 걸린 PDF(비밀번호 800505)는 pypdf로 따로 만들었다:
//    python3 -c "from pypdf import PdfReader, PdfWriter; r=PdfReader('tests/fixtures/policy-sample.pdf'); w=PdfWriter(); [w.add_page(p) for p in r.pages]; w.encrypt('800505', algorithm='AES-256'); w.write('tests/fixtures/policy-locked.pdf')"
