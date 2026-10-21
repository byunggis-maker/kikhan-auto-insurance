import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 테스트 임시 파일은 v6/tmp-test/에만 만든다(라운드 7 마무리 지시 3, MASTER.md D-10). 이 폴더는 .gitignore 대상이다.
// 운영체제 임시 폴더(os.tmpdir())를 쓰는 라이브러리도 이곳을 쓰게 TMPDIR을 바꾼다.
export const TEST_TMP = fileURLToPath(new URL("../tmp-test/", import.meta.url));
mkdirSync(TEST_TMP, { recursive: true });
process.env.TMPDIR = TEST_TMP;
process.env.TMP = TEST_TMP;
process.env.TEMP = TEST_TMP;
