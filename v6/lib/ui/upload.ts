// 서류 사진을 보내기 전에 브라우저에서 긴 변 2000px 이하의 JPEG로 줄인다(V2 compass/lib/upload/shrink.ts와 같은 방식).
// Vercel 함수가 한 번에 받는 크기(4.5MB)를 넘지 않게 하려는 것이다. PDF는 그대로 보낸다.
// HEIC를 그리지 못하는 브라우저(크롬·안드로이드)는 원본을 보내고 서버가 JPEG로 바꾼다. 사진은 이 요청 밖 어디에도 저장하지 않는다.

export const UPLOAD_LIMIT = 4 * 1024 * 1024;
/** 고를 수 있는 파일 한 건의 크기(라운드 8). 사진은 줄여서 UPLOAD_LIMIT 안으로 보낸다 */
export const MAX_PICK_BYTES = 10 * 1024 * 1024;
/** 한 번에 고를 수 있는 파일 수(라운드 8) */
export const MAX_PICK_FILES = 5;
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
