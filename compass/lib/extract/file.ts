import { ApiError } from "@/lib/guard/http";
import { join } from "node:path";
import convert from "heic-convert";
import sharp from "sharp";
import { definePDFJSModule, extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { findResidentNumber, maskResidentNumbers, type ResidentParts } from "@/lib/privacy/rrn";

// 올린 파일을 비전 LLM에 보낼 수 있는 꼴로 바꾼다.
// - HEIC(아이폰 사진)는 JPEG로 바꾼다.
// - PDF는 글자를 먼저 뽑고, 글자가 없으면(스캔본) 쪽을 그림으로 바꾼다.
// 파일은 메모리에서만 다루고 디스크에 쓰지 않는다.

/** Vercel 함수의 요청 본문 한도(4.5MB)보다 조금 작게 잡는다. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PDF_PAGES = 3;
const MAX_IMAGE_EDGE = 2000;
const MAX_TEXT_CHARS = 20000;
/** 이보다 글자가 적으면 글자가 없는 PDF(스캔본)로 본다. */
const MIN_TEXT_CHARS = 50;

export type FileKind = "pdf" | "jpeg" | "png" | "heic";

export type Prepared = {
  source: "pdf-text" | "pdf-scan" | "image";
  /** 주민등록번호 뒷자리를 가린 글. 글이 없으면 null */
  text: string | null;
  /** JPEG 그림들 */
  images: Buffer[];
  /** PDF 글자에서 서버가 직접 찾은 주민등록번호의 앞 6자리와 뒷자리 첫 숫자 */
  resident: ResidentParts | null;
};

// 한국 보험사 PDF에는 한글 문자표(CMap)가 따로 있어야 글자가 읽히는 글꼴이 많다.
// 문자표를 함께 싣는 공식 pdf.js를 쓰고, 문자표와 기본 글꼴의 위치를 알려 준다.
const PDFJS_DIR = join(process.cwd(), "node_modules", "pdfjs-dist");
const PDF_OPTIONS = { cMapUrl: `${join(PDFJS_DIR, "cmaps")}/`, cMapPacked: true, standardFontDataUrl: `${join(PDFJS_DIR, "standard_fonts")}/` };
let pdfjsReady: Promise<void> | undefined;
const loadPdfjs = () => (pdfjsReady ??= definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs")));

const fail = (status: number, code: string, message: string) => new ApiError(status, code, message);

/** 파일 이름이나 브라우저가 알려 준 형식을 믿지 않고 파일의 첫 바이트로 형식을 가린다. */
export function detectKind(bytes: Uint8Array): FileKind | null {
  const head = Buffer.from(bytes.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brands = head.subarray(8, 40).toString("latin1");
    if (/heic|heix|heim|heis|hevc|hevx|mif1|msf1/.test(brands)) return "heic";
  }
  return null;
}

async function toJpeg(input: Uint8Array): Promise<Buffer> {
  try {
    return await sharp(input, { failOn: "none" })
      .rotate() // 휴대폰 사진의 회전 정보를 반영한다
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw fail(422, "FILE_UNREADABLE", "사진을 열지 못했습니다. 다시 찍거나 다른 파일을 올려 주세요.");
  }
}

async function heicToJpeg(input: Uint8Array): Promise<Buffer> {
  let converted: Uint8Array;
  try {
    converted = await convert({ buffer: input, format: "JPEG", quality: 0.9 });
  } catch {
    throw fail(422, "FILE_UNREADABLE", "아이폰 사진(HEIC)을 열지 못했습니다. 화면을 캡처해 올리거나 다시 찍어 주세요.");
  }
  return toJpeg(new Uint8Array(converted));
}

async function preparePdf(bytes: Uint8Array, password: string | undefined): Promise<Prepared> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    await loadPdfjs();
    // pdf.js가 넘겨받은 배열을 가져가 버리므로 복사본을 준다.
    document = await getDocumentProxy(bytes.slice(), password ? { ...PDF_OPTIONS, password } : PDF_OPTIONS);
  } catch (error) {
    if ((error as { name?: string })?.name === "PasswordException") {
      throw password
        ? fail(422, "PDF_PASSWORD_WRONG", "PDF 비밀번호가 맞지 않습니다. 다시 확인해 주세요.")
        : fail(422, "PDF_PASSWORD", "비밀번호가 걸린 PDF입니다. 비밀번호를 입력해 주세요. (보험사 PDF는 보통 생년월일 6자리입니다)");
    }
    throw fail(422, "FILE_UNREADABLE", "PDF를 열지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.");
  }

  try {
    const { text } = await extractText(document, { mergePages: true });
    if (text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) {
      const cut = text.slice(0, MAX_TEXT_CHARS);
      return { source: "pdf-text", text: maskResidentNumbers(cut), images: [], resident: findResidentNumber(cut) };
    }
    // 글자가 없는 스캔본: 앞쪽 몇 쪽을 그림으로 바꾼다.
    const images: Buffer[] = [];
    for (let page = 1; page <= Math.min(document.numPages, MAX_PDF_PAGES); page++) {
      const png = await renderPageAsImage(document, page, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 });
      images.push(await toJpeg(new Uint8Array(png)));
    }
    return { source: "pdf-scan", text: null, images, resident: null };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw fail(422, "FILE_UNREADABLE", "PDF를 읽지 못했습니다. 화면을 캡처한 사진으로 올려 주세요.");
  } finally {
    await document.cleanup().catch(() => undefined);
  }
}

export async function prepareFile(bytes: Uint8Array, options: { password?: string } = {}): Promise<Prepared> {
  if (bytes.byteLength === 0) throw fail(400, "FILE_EMPTY", "빈 파일입니다. 다른 파일을 올려 주세요.");
  if (bytes.byteLength > MAX_FILE_BYTES) throw fail(413, "FILE_TOO_LARGE", "파일이 너무 큽니다. 4MB 이하의 파일을 올려 주세요.");
  const kind = detectKind(bytes);
  if (!kind) throw fail(415, "FILE_TYPE", "PDF, JPG, PNG, HEIC(아이폰 사진) 파일만 읽을 수 있습니다.");
  if (kind === "pdf") return preparePdf(bytes, options.password);
  const image = kind === "heic" ? await heicToJpeg(bytes) : await toJpeg(bytes);
  return { source: "image", text: null, images: [image], resident: null };
}
