// 서류 사진을 보내기 전에 브라우저에서 긴 변 2000px 이하의 JPEG로 줄인다(V2 compass/lib/upload/shrink.ts와 같은 방식).
// Vercel 함수가 한 번에 받는 크기(4.5MB)를 넘지 않게 하려는 것이다. PDF는 그대로 보낸다.
// HEIC를 그리지 못하는 브라우저(크롬·안드로이드)는 원본을 보내고 서버가 JPEG로 바꾼다. 사진은 이 요청 밖 어디에도 저장하지 않는다.
// 라운드 8b: 4MB가 넘는 PDF는 브라우저에서 앞 5쪽까지 쪽마다 사진(JPEG)으로 그려 사진처럼 보낸다(pdf.js, 서버 저장 없음).

export const UPLOAD_LIMIT = 4 * 1024 * 1024;
/** 고를 수 있는 파일 한 건의 크기(라운드 8). 사진은 줄여서 UPLOAD_LIMIT 안으로 보낸다 */
export const MAX_PICK_BYTES = 10 * 1024 * 1024;
/** 한 번에 고를 수 있는 파일 수(라운드 8) */
export const MAX_PICK_FILES = 5;
/** 큰 PDF에서 사진으로 바꿔 보낼 최대 쪽 수(라운드 8b) */
export const MAX_PDF_PAGES = 5;
const TARGET_EDGE = 2000;

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export async function prepareUpload(file: File): Promise<Blob> {
  if (isPdf(file)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const edge = Math.max(bitmap.width, bitmap.height);
    if (edge <= TARGET_EDGE && file.size <= UPLOAD_LIMIT && /^image\/(jpeg|png)$/.test(file.type)) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, TARGET_EDGE / edge);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    // 이 브라우저가 그리지 못하는 형식(HEIC 등)이면 그대로 보낸다
    return file;
  }
}

/** 보낼 조각 하나. 큰 PDF는 쪽마다 하나(page는 1부터, pages는 PDF 전체 쪽 수) */
export type UploadPart = { blob: Blob; page?: number; pages?: number };
export type RenderPdf = (file: Blob, maxPages: number) => Promise<{ images: Blob[]; pageCount: number }>;

/** 고른 파일 하나를 보낼 조각으로 만든다. 4MB가 넘는 PDF만 쪽마다 사진으로 바꾸고, 나머지는 prepareUpload와 같다 */
export async function prepareUploads(file: File, renderPdf: RenderPdf = renderPdfPages): Promise<UploadPart[]> {
  if (!isPdf(file) || file.size <= UPLOAD_LIMIT) return [{ blob: await prepareUpload(file) }];
  const { images, pageCount } = await renderPdf(file, MAX_PDF_PAGES);
  return images.map((blob, i) => ({ blob, page: i + 1, pages: pageCount }));
}

/** 큰 PDF면 쪽 수와 쓸 횟수(쪽마다 1회, 최대 5회). 큰 PDF가 아니면 null. 열지 못하면 예외 */
export async function pdfPlan(file: File, countPages: (file: Blob) => Promise<number> = countPdfPages): Promise<{ pages: number; uses: number } | null> {
  if (!isPdf(file) || file.size <= UPLOAD_LIMIT) return null;
  const pages = await countPages(file);
  return { pages, uses: Math.min(pages, MAX_PDF_PAGES) };
}

/** 큰 PDF를 올리기 전 안내(라운드 8c). 라운드 8d: 서버마다 따로 세어 정확하지 않은 "오늘 남은 횟수"는 보여 주지 않는다 */
export function pdfUseNotice(plan: { pages: number; uses: number }): string {
  const pages = plan.pages > plan.uses ? ` 전체 ${plan.pages}쪽 중 앞 ${plan.uses}쪽을 한 쪽씩 사진으로 바꿔 읽습니다.` : ` ${plan.pages}쪽을 한 쪽씩 사진으로 바꿔 읽습니다.`;
  return `이 PDF는 ${plan.uses}회를 씁니다.${pages}`;
}

async function loadPdf(file: Blob) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

export async function countPdfPages(file: Blob): Promise<number> {
  const doc = await loadPdf(file);
  const pages = doc.numPages;
  void doc.destroy();
  return pages;
}

/** pdf.js(legacy 빌드)로 앞 maxPages쪽을 긴 변 2000px 이하 JPEG로 그린다. 열지 못하면 예외 */
export async function renderPdfPages(file: Blob, maxPages: number): Promise<{ images: Blob[]; pageCount: number }> {
  const doc = await loadPdf(file);
  try {
    const images: Blob[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: TARGET_EDGE / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d")!;
      // 투명 바탕이 JPEG에서 검게 나오지 않게 흰 바탕을 깐다
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      page.cleanup();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("render");
      images.push(blob);
    }
    return { images, pageCount: doc.numPages };
  } finally {
    void doc.destroy();
  }
}

/** 고른 파일이 한도(한 번에 5건, 한 건 10MB) 안인지. 넘으면 안내 문구, 괜찮으면 null */
export function checkPicked(files: { size: number }[]): string | null {
  if (files.length > MAX_PICK_FILES) return `한 번에 ${MAX_PICK_FILES}건까지 올릴 수 있습니다. 나눠서 올려 주세요.`;
  if (files.some((f) => f.size > MAX_PICK_BYTES)) return "10MB가 넘는 파일은 올릴 수 없습니다. 더 작은 파일이나 사진으로 올려 주세요.";
  return null;
}

/** 서버 응답의 공통 모양. 실패하면 message를 그대로 보여 준다 */
export type ApiResult<T> = ({ ok: true } & T) | { ok: false; reason: "unavailable" | "invalid" | "limited"; message: string };

export async function postForm<T>(url: string, form: FormData): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { method: "POST", body: form });
    const data = (await response.json().catch(() => null)) as ApiResult<T> | null;
    if (data && typeof data === "object" && "ok" in data) return data;
  } catch {
    // 네트워크가 끊겨도 직접 입력으로 돌아간다
  }
  return { ok: false, reason: "unavailable", message: "이 기능은 준비 중입니다. 직접 입력해 주세요." };
}
