// PDF 저장(lib/export/pdf.ts)에 쓰는 Pretendard TTF를 node_modules에서 public/fonts로 복사한다.
// 2.7MB짜리 글꼴 두 개를 저장소에 넣지 않으려고 dev·build 전에 복사한다(public/fonts는 .gitignore). 글꼴 사용 허가: SIL OFL 1.1(LICENSE.txt 함께 복사).
import { copyFileSync, mkdirSync } from "node:fs";

const from = "node_modules/pretendard/dist";
mkdirSync("public/fonts", { recursive: true });
for (const name of ["Pretendard-Regular.ttf", "Pretendard-Bold.ttf"]) copyFileSync(`${from}/public/static/alternative/${name}`, `public/fonts/${name}`);
copyFileSync(`${from}/LICENSE.txt`, "public/fonts/Pretendard-LICENSE.txt");
