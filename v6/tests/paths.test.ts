import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_TMP } from "./setup";

// 재발 방지(라운드 7 마무리 지시 3): 테스트·스크립트 코드가 v6 밖에 파일을 쓰지 않는지 확인한다.

const V6 = resolve(".");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "fixtures" ? [] : files(join(dir, e.name))) : /\.(ts|mjs)$/.test(e.name) ? [join(dir, e.name)] : []));
const WRITE = /(writeFileSync|writeFile|mkdirSync|mkdir|copyFileSync|appendFileSync|rmSync|createWriteStream|saveAs|screenshot|\.pdf)\(\s*(\{[^}]*path:\s*)?[`"']([^`"']*)/g;

describe("파일 쓰기 위치", () => {
  it("테스트 중 임시 폴더는 v6/tmp-test/", () => {
    expect(TEST_TMP.startsWith(V6)).toBe(true);
    expect(resolve(tmpdir()).startsWith(resolve(TEST_TMP))).toBe(true);
  });

  it("tests/·scripts/의 파일 쓰기 경로가 모두 v6 안(상대 경로, '..'로 나가지 않음)", () => {
    const bad: string[] = [];
    for (const file of [...files("tests"), ...files("scripts")]) {
      for (const match of readFileSync(file, "utf8").matchAll(WRITE)) {
        const path = match[3];
        if (path.startsWith("/") || path.startsWith("~") || resolve(path).startsWith(V6) === false) bad.push(`${file}: ${match[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
