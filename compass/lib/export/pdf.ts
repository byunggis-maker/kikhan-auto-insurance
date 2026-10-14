import { rangeText } from "@/lib/engine/range";
import type { Result } from "@/lib/result/compute";
import { DISCLAIMER, EXCLUDED_LABEL, STATUS_LABELS } from "./book";

// PDF 요약(1~2쪽). 금액은 엔진의 결과를 그대로 적는다.
// 한글 글꼴을 파일에 넣지 않으려고, 화면이 기기의 글꼴로 쪽을 그림(JPEG)으로 그리고 여기서 그 그림을 PDF 쪽으로 싼다.

export type SummaryLine = { text: string; style: "title" | "heading" | "amount" | "body" | "small" };

const GROUPS = { mine: "내가 받을 예상 보험금", others: "상대방에게 지급될 예상 금액" } as const;

/** PDF에 적을 줄. createdAt은 화면이 넘겨 준다 */
export function summaryLines(result: Result, createdAt: string): SummaryLine[] {
  const { matrix, summary } = result;
  const lines: SummaryLine[] = [
    { text: "자동차보험 예상 보험금 요약", style: "title" },
    { text: `사고일 ${matrix.accidentDate} · 만든 날 ${createdAt}`, style: "small" },
  ];
  for (const group of summary.groups) {
    if (group.group === "others" && group.countedCells === 0) continue;
    lines.push({ text: GROUPS[group.group], style: "heading" });
    lines.push({ text: group.countedCells > 0 ? rangeText(group.total) : "계산된 칸 없음 (부족한 정보를 입력하면 계산됩니다)", style: "amount" });
  }
  for (const row of matrix.rows) {
    lines.push({ text: `${row.label} (${row.group === "mine" ? "내 쪽" : "상대방 쪽"})`, style: "heading" });
    for (const cell of matrix.cells.filter((candidate) => candidate.rowId === row.id)) {
      const label = matrix.columns.find((column) => column.id === cell.columnId)?.label ?? cell.columnId;
      if (cell.status === "not_applicable") continue;
      const amount = cell.status === "calculated" && cell.amount ? `${rangeText(cell.amount)}${cell.inTotal ? "" : ` (${EXCLUDED_LABEL})`}` : (cell.reason ?? STATUS_LABELS[cell.status]);
      lines.push({ text: `${label}: ${amount}`, style: "body" });
    }
  }
  lines.push({ text: `규칙 파일 버전 ${result.rulesVersion} · 엔진 ${result.engineVersion}`, style: "small" });
  lines.push({ text: "항목별 내역과 근거 조항은 엑셀 파일에 있습니다.", style: "small" });
  lines.push({ text: DISCLAIMER, style: "small" });
  return lines;
}

export type JpegPage = { jpeg: Uint8Array; width: number; height: number };

/** A4 크기(pt) */
const PAGE = { width: 595, height: 842 };

/** JPEG 그림 한 장을 한 쪽으로 하는 PDF를 만든다. 그림은 쪽에 꽉 차게 놓는다 */
export function buildImagePdf(pages: JpegPage[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  // 객체 번호: 1 목록, 2 쪽 묶음, 그 뒤로 쪽마다 (쪽, 내용, 그림) 세 개.
  const pageId = (index: number) => 3 + index * 3;
  push("%PDF-1.4\n%âãÏÓ\n");
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(" ")}] >>`));
  pages.forEach((page, index) => {
    const id = pageId(index);
    const content = `q ${PAGE.width} 0 0 ${PAGE.height} 0 0 cm /Im0 Do Q`;
    object(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    object(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    object(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
      push(page.jpeg);
      push("\nendstream");
    });
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const STYLES: Record<SummaryLine["style"], { size: number; bold: boolean; gapBefore: number; color: string }> = {
  title: { size: 22, bold: true, gapBefore: 0, color: "#0b2545" },
  heading: { size: 14, bold: true, gapBefore: 14, color: "#0b2545" },
  amount: { size: 18, bold: true, gapBefore: 2, color: "#111111" },
  body: { size: 11, bold: false, gapBefore: 3, color: "#111111" },
  small: { size: 9, bold: false, gapBefore: 6, color: "#555555" },
};
const MAX_PAGES = 2;

/** 브라우저에서만 쓴다. 줄을 A4 쪽 그림으로 그려 PDF로 만든다. 2쪽을 넘는 내용은 줄이고 엑셀을 안내한다 */
export async function summaryPdf(lines: SummaryLine[]): Promise<Uint8Array> {
  const scale = 2.5;
  const margin = 48;
  const width = PAGE.width - margin * 2;
  const canvases: HTMLCanvasElement[] = [];
  let context: CanvasRenderingContext2D;
  let y = 0;
  const newPage = () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(PAGE.width * scale);
    canvas.height = Math.round(PAGE.height * scale);
    context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.scale(scale, scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PAGE.width, PAGE.height);
    context.textBaseline = "top";
    canvases.push(canvas);
    y = margin;
  };
  newPage();
  let truncated = false;
  outer: for (const line of lines) {
    const style = STYLES[line.style];
    context!.font = `${style.bold ? "bold " : ""}${style.size}px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;
    // 낱말이 아니라 글자 단위로 줄을 바꾼다(한글).
    const wrapped: string[] = [];
    let current = "";
    for (const char of line.text) {
      if (current && context!.measureText(current + char).width > width) {
        wrapped.push(current);
        current = char;
      } else current += char;
    }
    if (current) wrapped.push(current);
    y += style.gapBefore;
    for (const text of wrapped) {
      if (y + style.size * 1.4 > PAGE.height - margin) {
        if (canvases.length >= MAX_PAGES) {
          truncated = true;
          break outer;
        }
        newPage();
        context!.font = `${style.bold ? "bold " : ""}${style.size}px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;
      }
      context!.fillStyle = style.color;
      context!.fillText(text, margin, y);
      y += style.size * 1.4;
    }
  }
  if (truncated) {
    // 마지막 쪽 아래에 꼭 있어야 하는 문구를 다시 적는다.
    context!.fillStyle = "#ffffff";
    context!.fillRect(0, PAGE.height - margin - 6, PAGE.width, margin + 6);
    context!.fillStyle = "#555555";
    context!.font = `9px "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`;
    context!.fillText(`내용이 길어 줄였습니다. 전체 내역은 엑셀 파일에 있습니다. ${DISCLAIMER}`, margin, PAGE.height - margin);
  }
  const pages: JpegPage[] = [];
  for (const canvas of canvases) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("PDF를 만들지 못했습니다.");
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
  }
  return buildImagePdf(pages);
}
