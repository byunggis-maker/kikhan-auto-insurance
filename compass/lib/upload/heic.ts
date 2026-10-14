// 아이폰 사진(HEIC)을 브라우저에서 JPEG로 바꾼다.
// 아이폰 Safari는 HEIC를 직접 그릴 수 있어 이 변환이 필요 없다. 크롬·안드로이드처럼 HEIC를 열지 못하는 브라우저에서만 쓴다.
// 변환 도구(heic2any)는 크기가 커서 필요할 때만 불러온다. 사진은 이 기기 밖으로 나가지 않는다.

export function looksHeic(file: File) {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** HEIC면 JPEG로 바꾼 파일을, 아니거나 바꾸지 못하면 null을 돌려준다. */
export async function heicToJpeg(file: File): Promise<File | null> {
  if (!looksHeic(file)) return null;
  try {
    const { default: heic2any } = await import("heic2any");
    const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const blob = Array.isArray(result) ? result[0] : result;
    return blob ? new File([blob], "policy.jpg", { type: "image/jpeg" }) : null;
  } catch {
    return null;
  }
}
