// 큰 PDF를 브라우저에서 쪽마다 사진으로 바꿀 때(라운드 8b, lib/ui/upload.ts) 쓰는 pdf.js 작업 파일을 public/pdfjs로 복사한다.
// 저장소에 넣지 않으려고 dev·build 전에 복사한다(public/pdfjs는 .gitignore). 옛 아이폰에서도 돌도록 legacy 빌드를 쓴다.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/pdfjs", { recursive: true });
copyFileSync("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "public/pdfjs/pdf.worker.min.mjs");
