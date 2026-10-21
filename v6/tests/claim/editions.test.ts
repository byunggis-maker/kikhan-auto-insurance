import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITIONS, STANDARDS_EDITION, editionFor, latestEdition } from "@/lib/claim/editions";

// 약관 판 목록(결정 기록 D-21). 등록한 판의 파일이 data/raw/policies/에 있으면 sha256이 같은지 확인한다.

const POLICIES = join(__dirname, "..", "..", "..", "data", "raw", "policies");

describe("약관 판", () => {
  it("사고일에 시행 중인 판을 고른다. 없으면 null", () => {
    expect(editionFor("2026-10-25")?.id).toBe("2026-10-25");
    expect(editionFor("2027-01-01")?.id).toBe("2026-10-25");
    expect(editionFor("2026-09-01")).toBeNull();
    expect(latestEdition().id).toBe(STANDARDS_EDITION);
  });

  it.skipIf(!existsSync(POLICIES))("등록한 PDF의 sha256이 실제 파일과 같다", () => {
    for (const edition of EDITIONS)
      for (const [line, file] of Object.entries(edition.files)) {
        const path = join(POLICIES, file.path);
        expect(existsSync(path), `${edition.id} ${line}: ${path}`).toBe(true);
        expect(createHash("sha256").update(readFileSync(path)).digest("hex"), `${edition.id} ${line}`).toBe(file.sha256);
      }
  });
});
