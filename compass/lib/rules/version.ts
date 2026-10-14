import version from "@/data/rules/version.json";

/** 규칙 파일(data/rules/*.json) 전체의 해시. scripts/rules-version.mjs가 만든다 */
export const RULES_VERSION: string = version.version;

/** 계산 엔진의 버전. 계산 방식이 바뀌면 올린다 */
export const ENGINE_VERSION = "2.0.0-step8";
