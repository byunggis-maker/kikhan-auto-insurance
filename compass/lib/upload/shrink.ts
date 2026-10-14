// 큰 사진을 올리기 전에 브라우저에서 줄인다. 서버가 한 번에 받을 수 있는 크기(4MB)를 넘지 않게 하기 위함이다.
// PDF는 줄이지 않는다.

export const UPLOAD_LIMIT = 4 * 1024 * 1024;
const TARGET_EDGE = 2400;

export async function shrinkIfLarge(file: File): Promise<File> {
  if (file.size <= UPLOAD_LIMIT || file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, TARGET_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], "policy.jpg", { type: "image/jpeg" }) : file;
  } catch {
    // 이 브라우저가 열지 못하는 형식이면 그대로 보낸다(서버가 크기를 확인한다).
    return file;
  }
}
