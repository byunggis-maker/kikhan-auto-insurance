// 규칙 파일 전체의 해시를 data/rules/version.json에 적는다. 결과를 저장할 때 어떤 규칙으로 계산했는지 남기는 데 쓴다.
// 규칙 파일(data/rules 아래의 json)을 고친 뒤에는 반드시 다시 실행한다: node scripts/rules-version.mjs
// tests/rules-version.test.ts가 파일과 해시가 맞는지 확인한다.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

export function rulesHash(root = "data/rules") {
  const files = readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".json") && name !== "version.json")
    .sort();
  const hash = createHash("sha256");
  for (const name of files) hash.update(`${name}\n`).update(readFileSync(`${root}/${name}`));
  return { version: `sha256:${hash.digest("hex")}`, files: files.length };
}

if (process.argv[1]?.endsWith("rules-version.mjs")) {
  const result = rulesHash();
  writeFileSync("data/rules/version.json", `${JSON.stringify(result, null, 2)}\n`);
  console.log(result.version, `(${result.files}개 파일)`);
}
