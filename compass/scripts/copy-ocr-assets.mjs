// 사진 속 개인정보 자리 찾기(components/ocr.ts)에 쓰는 글자 인식 파일을 public/ocr/로 복사한다.
// 외부 CDN에서 받지 않고 이 앱 주소에서 내려주기 위해서다. npm run dev·build 전에 저절로 돈다.
// 복사본은 git에 올리지 않는다(.gitignore). 원본은 node_modules의 tesseract.js·tesseract.js-core·@tesseract.js-data/kor.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "ocr");
mkdirSync(out, { recursive: true });

const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  // 글자 인식 엔진(LSTM 전용). 기기 기능에 따라 셋 중 하나만 받는다.
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"],
  // 한국어 인식 자료(숫자·영문 포함)
  ["node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz", "kor.traineddata.gz"],
];
for (const [from, to] of files) copyFileSync(join(root, from), join(out, to));
console.log(`ocr assets → public/ocr (${files.length} files)`);
