import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import { TO_COUNTERPARTY_NOTE, UNCALCULATED_STATUS, type Review } from "@/lib/report/review";

// MASTER.md 8장 PDF 저장: A4 세로. 브라우저 인쇄가 아니라 파일을 만든다.
// 한글은 Pretendard TTF를 넣는다(쓴 글자만 담는 subset이라 파일이 작다). OTF(CFF)는 pdf-lib subset이 깨져 쓰지 않는다.
// pdf-lib는 크므로 저장 버튼을 누를 때만 불러온다(dynamic import). 글꼴 파일은 부르는 쪽이 넘긴다(브라우저: /fonts, 테스트: node_modules).

export type PdfFonts = { regular: Uint8Array; bold: Uint8Array };

export const PDF_FONT_FILES = { regular: "Pretendard-Regular.ttf", bold: "Pretendard-Bold.ttf" } as const;

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const FOOTER = 36;
const WIDTH = A4[0] - MARGIN * 2;

/**
 * Pretendard의 문맥 대체(calt)는 숫자 사이의 "-"·":"를 다른 글리프로 바꾸는데, pdf-lib는 바꾸기 전 글자 폭으로 자리를 잡아
 * "2026-  09"처럼 틈이 생긴다. 끄고 기본 글리프를 쓴다.
 */
const FEATURES = { calt: false };

type Fontkit = Parameters<import("pdf-lib").PDFDocument["registerFontkit"]>[0];
type SubsetInternals = { _addGlyph: (gid: number) => number; glyf: Uint8Array[]; offset: number };

/**
 * @pdf-lib/fontkit 1.1.1의 TrueType subset 버그를 피한다. 원본(Pretendard)은 loca 긴 형식이고 글리프 길이가 홀수인 것이 있는데,
 * subset이 작아지면 짧은 형식(위치 ÷ 2)으로 바꾸면서 홀수 길이 글리프를 맞추지 않아 뒤 글리프가 깨진다(PDF에서 글자가 빈칸).
 * 글리프마다 4바이트 단위로 0을 채워 위치가 항상 짝수가 되게 한다. 테스트: tests/report/review.test.ts "글리프가 모두 그려진다".
 */
function alignedSubsets(fontkit: Fontkit): Fontkit {
  return {
    create(data, name) {
      const font = fontkit.create(data, name);
      const createSubset = font.createSubset.bind(font);
      font.createSubset = () => {
        const subset = createSubset() as unknown as SubsetInternals;
        const addGlyph = subset._addGlyph.bind(subset);
        subset._addGlyph = (gid) => {
          const index = addGlyph(gid);
          const glyph = subset.glyf[index];
          const extra = (4 - (glyph.length % 4)) % 4;
          if (extra) {
            const Bytes = glyph.constructor as { alloc?: (n: number) => Uint8Array };
            const padded = Bytes.alloc ? Bytes.alloc(glyph.length + extra) : new Uint8Array(glyph.length + extra);
            padded.set(glyph);
            subset.glyf[index] = padded;
            subset.offset += extra;
          }
          return index;
        };
        return subset as unknown as ReturnType<typeof createSubset>;
      };
      return font;
    },
  };
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export async function reviewToPdf(review: Review, fonts: PdfFonts): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const doc = await PDFDocument.create();
  doc.registerFontkit(alignedSubsets(fontkit));
  doc.setTitle("보상 검토서");
  doc.setCreator("키칸 자동차보험 보상 나침반");
  const regular = await doc.embedFont(fonts.regular, { subset: true, features: FEATURES });
  const bold = await doc.embedFont(fonts.bold, { subset: true, features: FEATURES });
  // 글꼴에 없는 글자(이모지 등)는 □로 바꾼다. 없는 글자를 그리면 pdf-lib가 멈춘다
  const known = new Set(regular.getCharacterSet());
  const safe = (text: string) => [...text.replace(/\r?\n/g, " ")].map((ch) => (known.has(ch.codePointAt(0)!) ? ch : "□")).join("");

  const INK = rgb(0.043, 0.071, 0.125);
  const SOFT = rgb(0.25, 0.29, 0.35);
  const ESTIMATE = rgb(0.043, 0.29, 0.561);
  const ESTIMATE_BG = rgb(0.91, 0.945, 0.992);
  const LINE = rgb(0.81, 0.84, 0.88);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - MARGIN;
  };
  const ensure = (height: number) => {
    if (y - height < MARGIN + FOOTER) newPage();
  };

  /** 너비에 맞춰 줄을 나눈다. 띄어쓰기에서 먼저 나누고, 한 낱말이 너무 길면 글자 단위로 나눈다 */
  function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of safe(text).split(/(\s+)/)) {
      if (font.widthOfTextAtSize(line + word, size) <= width) {
        line += word;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = word.trimStart();
      while (font.widthOfTextAtSize(line, size) > width) {
        let cut = line.length;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines.length ? lines : [""];
  }

  type TextOptions = { size?: number; bold?: boolean; color?: RGB; indent?: number; width?: number; gap?: number };
  function text(content: string, options: TextOptions = {}) {
    const size = options.size ?? 10;
    const font = options.bold ? bold : regular;
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.5;
    for (const line of wrap(content, font, size, (options.width ?? WIDTH) - indent)) {
      ensure(lineHeight);
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color: options.color ?? INK });
      y -= lineHeight;
    }
    y -= options.gap ?? 0;
  }

  function heading(content: string) {
    ensure(40);
    y -= 10;
    text(content, { size: 13, bold: true, gap: 2 });
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: 1.2, color: INK });
    y -= 6;
  }

  /** 금액 표: 첫 열은 글자(줄바꿈), 나머지 열은 오른쪽 맞춤 숫자 */
  type Cell = { value: string; color?: RGB; bold?: boolean };
  function row(cells: Cell[], widths: number[], isHead = false) {
    const size = 9;
    const lineHeight = size * 1.5;
    const firstLines = wrap(cells[0].value, isHead || cells[0].bold ? bold : regular, size, widths[0] - 6);
    const height = firstLines.length * lineHeight + 6;
    ensure(height);
    let x = MARGIN;
    cells.forEach((cell, i) => {
      const font = isHead || cell.bold ? bold : regular;
      const color = cell.color ?? INK;
      if (i === 0) firstLines.forEach((line, n) => page.drawText(line, { x: x + 2, y: y - 3 - size - n * lineHeight, size, font, color }));
      else {
        const value = safe(cell.value);
        page.drawText(value, { x: x + widths[i] - 2 - font.widthOfTextAtSize(value, size), y: y - 3 - size, size, font, color });
      }
      x += widths[i];
    });
    y -= height;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness: isHead ? 0.9 : 0.5, color: isHead ? INK : LINE });
  }
  function table(head: string[], rows: Cell[][], widths: number[]) {
    row(head.map((value) => ({ value })), widths, true);
    for (const cells of rows) row(cells, widths);
    y -= 6;
  }

  // ── 맨 위: 제목·고지·사고 ──
  text("보상 검토서", { size: 20, bold: true, gap: 4 });
  const noticeLines = wrap(review.notice, bold, 11, WIDTH - 20);
  const noticeHeight = noticeLines.length * 16.5 + 12;
  page.drawRectangle({ x: MARGIN, y: y - noticeHeight, width: WIDTH, height: noticeHeight, color: ESTIMATE_BG, borderColor: ESTIMATE, borderWidth: 1 });
  noticeLines.forEach((line, n) => page.drawText(line, { x: MARGIN + 10, y: y - 6 - 11 - n * 16.5, size: 11, font: bold, color: ESTIMATE }));
  y -= noticeHeight + 10;

  text(`사고일 ${review.accident.date} · ${review.accident.type} · 장소 ${review.accident.place}`, { size: 10, bold: true });
  text(`내 과실 ${review.faultKnown ? `${review.faultPercent}%` : `모름 — 아래 금액은 내 과실 ${review.faultPercent}% 경우(다른 경우는 과실 시나리오 표)`}`, { size: 10, bold: true });
  if (review.accident.narrative) text(`사고 경위: ${review.accident.narrative}`, { size: 9, color: SOFT });
  y -= 6;

  // ── 세 숫자 ──
  if (review.blocked) text(review.blocked, { size: 12, bold: true, gap: 6 });
  else {
    const boxes = [
      { label: "확정 기준 받을 돈", value: review.top.receiveConfirmed, sub: "서류로 확인한 금액만", color: INK, fill: rgb(1, 1, 1) },
      { label: "추정 포함 받을 돈", value: review.top.receiveWithEstimates, sub: `추정분 ${won(review.top.receiveEstimatePart)}`, color: ESTIMATE, fill: ESTIMATE_BG },
      { label: "내가 낼 돈(추정 포함)", value: review.top.burdenWithEstimates, sub: `확정 기준 ${won(review.top.burdenConfirmed)}`, color: INK, fill: rgb(1, 1, 1) },
    ];
    const gap = 8;
    const boxWidth = (WIDTH - gap * 2) / 3;
    const boxHeight = 62;
    ensure(boxHeight + 8);
    boxes.forEach((box, i) => {
      const x = MARGIN + i * (boxWidth + gap);
      page.drawRectangle({ x, y: y - boxHeight, width: boxWidth, height: boxHeight, color: box.fill, borderColor: box.color, borderWidth: 1.5 });
      page.drawText(box.label, { x: x + 8, y: y - 16, size: 9, font: bold, color: box.color });
      page.drawText(won(box.value), { x: x + 8, y: y - 38, size: 16, font: bold, color: box.color });
      page.drawText(safe(box.sub), { x: x + 8, y: y - 54, size: 8, font: regular, color: box.color });
    });
    y -= boxHeight + 8;
    if (review.top.toCounterparty > 0) {
      text(`내 보험이 상대방에게 줄 돈(추정 포함)*: ${won(review.top.toCounterparty)}`, { size: 10, bold: true });
      text(`* ${TO_COUNTERPARTY_NOTE}`, { size: 8, color: SOFT });
    }
  }

  heading("계산 기준");
  for (const line of review.standards) text(`· ${line}`, { size: 9 });

  heading("받을 곳별 합계");
  if (review.byPayer.length || review.uncalculated.length)
    table(
      ["받을 곳", "확정", "추정 포함"],
      [
        ...review.byPayer.map((p) => [{ value: p.payer, bold: true }, { value: won(p.confirmed) }, { value: won(p.withEstimates), color: ESTIMATE }]),
        // 라운드 9c: 앱이 계산하지 않은 줄은 0원 대신 '미계산'
        ...review.uncalculated.map((u) => [{ value: `${u.payer}(${u.card})`, bold: true }, { value: UNCALCULATED_STATUS }, { value: UNCALCULATED_STATUS }]),
      ],
      [WIDTH - 260, 130, 130],
    );
  else text("아직 받을 돈이 계산되지 않았습니다.", { size: 9 });

  // ── 사람·물건 카드별 담보 ──
  heading("사람·물건별 담보");
  for (const card of review.cards) {
    ensure(60);
    text(card.label, { size: 11, bold: true });
    text(`실제손해 확정 ${won(card.actualLoss.confirmed)} / 추정 포함 ${won(card.actualLoss.withEstimates)} · ${card.lines.some((l) => l.status === UNCALCULATED_STATUS) ? `나머지 ${won(card.uncovered.withEstimates)}은 ${UNCALCULATED_STATUS}` : `보상 안 되는 손해 ${won(card.uncovered.withEstimates)}`}`, { size: 8.5, color: SOFT, gap: 2 });
    const widths = [WIDTH - 300, 100, 100, 100];
    row(["담보 · 지급처", "확정", "추정 포함", "추정분"].map((value) => ({ value })), widths, true);
    for (const l of card.lines) {
      // 담보 줄과 그 아래 계산식이 쪽을 넘어 떨어지지 않게 한 덩어리 높이를 먼저 확보한다
      ensure(70);
      const amount = (n: number) => (l.status === UNCALCULATED_STATUS ? UNCALCULATED_STATUS : won(n));
      row([{ value: `${l.label} · ${l.payer}${l.status === "지급" ? "" : ` · ${l.status}`}`, bold: true }, { value: amount(l.confirmed), bold: true }, { value: amount(l.withEstimates), color: ESTIMATE, bold: true }, { value: amount(l.estimatePart), color: ESTIMATE }], widths);
      y -= 3;
      if (l.formula) text(`계산식: ${l.formula}`, { size: 8, indent: 6 });
      if (l.basis) text(`약관 조항: ${l.basis}`, { size: 8, indent: 6, color: SOFT });
      if (l.exclusion) text(`면책 사유: ${l.exclusion}`, { size: 8, indent: 6, bold: true });
      for (const flag of l.flags) text(`· ${flag}`, { size: 8, indent: 6, color: ESTIMATE });
      y -= 6;
    }
    for (const note of card.notes) text(`· ${note}`, { size: 8, color: SOFT });
    y -= 8;
  }

  if (review.burdens.length) {
    heading("내가 낼 돈 내역");
    const widths = [WIDTH - 260, 130, 130];
    row(["항목", "확정", "추정 포함"].map((value) => ({ value })), widths, true);
    for (const b of review.burdens) {
      ensure(50);
      row([{ value: b.label, bold: true }, { value: won(b.confirmed) }, { value: won(b.withEstimates), color: ESTIMATE }], widths);
      y -= 3;
      text(`${b.formula} (${b.basis})`, { size: 8, indent: 6, color: SOFT, gap: 4 });
    }
  }

  if (review.scenarios.length > 1) {
    heading("과실 시나리오");
    table(
      ["경우", "받을 돈(확정)", "받을 돈(추정 포함)", "내가 낼 돈(추정 포함)"],
      review.scenarios.map((s) => [{ value: s.label, bold: s.faultPercent === review.faultPercent }, { value: won(s.receiveConfirmed) }, { value: won(s.receiveWithEstimates), color: ESTIMATE }, { value: won(s.burdenWithEstimates) }]),
      [WIDTH - 330, 110, 110, 110],
    );
  }

  if (review.missing.length) {
    heading("입력 필요");
    for (const m of review.missing) text(`· ${m}`, { size: 9 });
  }

  // ── 필요 서류: 체크 칸은 네모를 직접 그린다(글꼴에 ☐ 글자가 없다) ──
  if (review.checklist.length) {
    heading("필요 서류 체크리스트");
    for (const group of review.checklist) {
      ensure(30);
      text(`${group.payer} · ${group.coverage}`, { size: 10, bold: true, gap: 1 });
      for (const d of group.docs) {
        const lines = wrap(`${d.label} (약관 제27조 ${d.clause27}호)`, regular, 9, WIDTH - 24);
        ensure(lines.length * 13.5);
        page.drawRectangle({ x: MARGIN + 6, y: y - 10.5, width: 8, height: 8, borderColor: INK, borderWidth: 0.8 });
        // 체크한 서류는 네모 안에 ✓ 모양 선을 긋는다
        if (d.checked) {
          page.drawLine({ start: { x: MARGIN + 7.5, y: y - 6.5 }, end: { x: MARGIN + 9.5, y: y - 9 }, thickness: 1.2, color: INK });
          page.drawLine({ start: { x: MARGIN + 9.5, y: y - 9 }, end: { x: MARGIN + 13, y: y - 3.5 }, thickness: 1.2, color: INK });
        }
        lines.forEach((line, n) => page.drawText(line, { x: MARGIN + 20, y: y - 9 - n * 13.5, size: 9, font: regular, color: INK }));
        y -= lines.length * 13.5;
      }
      y -= 4;
    }
  }

  if (review.nextSteps.length) {
    heading("다음 할 일");
    review.nextSteps.forEach((step, i) => text(`${i + 1}. ${step}`, { size: 9 }));
  }

  if (review.notices.length) {
    heading("안내");
    for (const n of review.notices) text(`※ ${n}`, { size: 8.5, color: SOFT });
  }

  // ── 모든 쪽 아래: 고지와 쪽 번호 ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footer = `${review.notice}  ·  ${i + 1} / ${pages.length}`;
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: MARGIN + WIDTH, y: MARGIN + 14 }, thickness: 0.5, color: LINE });
    p.drawText(footer, { x: MARGIN, y: MARGIN, size: 8, font: regular, color: SOFT });
  });

  return doc.save();
}
