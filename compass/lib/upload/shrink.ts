import { heicToJpeg } from "./heic";

// 사진을 올리기 전에 브라우저에서 긴 변 2000px 이하의 JPEG로 줄인다.
// Vercel 함수가 한 번에 받는 요청 크기(4.5MB)를 넘지 않게 하기 위함이다. PDF는 줄이지 않는다.

export const UPLOAD_LIMIT = 4 * 1024 * 1024;
const TARGET_EDGE = 2000;

export async function shrinkIfLarge(file: File): Promise<File> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return file;
  try {
    let source: Blob = file;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    } catch {
      // HEIC를 열지 못하는 브라우저면 JPEG로 바꾼 뒤 다시 연다.
      const jpeg = await heicToJpeg(file);
      if (!jpeg) return file;
      source = jpeg;
      bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    }
    const edge = Math.max(bitmap.width, bitmap.height);
    if (edge <= TARGET_EDGE && source.size <= UPLOAD_LIMIT && /^image\/(jpeg|png)$/.test(source.type)) {
      bitmap.close();
      return source instanceof File ? source : new File([source], "policy.jpg", { type: source.type });
    }
    const scale = Math.min(1, TARGET_EDGE / edge);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], "policy.jpg", { type: "image/jpeg" }) : file;
  } catch {
    // 이 브라우저가 열지 못하는 형식이면 그대로 보낸다(서버가 크기를 확인하고 HEIC도 바꾼다).
    return file;
  }
}
