=== 라운드 9f 보고서 ===

**1. 배포 게이트**
- `npm run verify`: `npm run test && npm run typecheck && npm run lint && npm run build`. 파이프 없이 `&&`로만 이어, 하나라도 실패하면 0이 아닌 종료코드로 멈춥니다.
- `npm run deploy`: `npm run verify && npx vercel@latest --prod --yes --scope byunggis-6992`. verify가 성공해야만 kikhan-auto-compass-v6에 배포합니다.
- 9e 원인: `npx vitest run 2>&1 | grep -E "…" && … && vercel --prod`에서 파이프 뒤 grep의 종료코드(0, 줄을 찾음)가 쓰여 vitest의 실패(1)를 놓쳤습니다.

**2. 게이트 시험**
- 일부러 실패하는 테스트(`tests/zz-gate-fail.test.ts`)를 넣고 `npm run deploy` 실행.
- 결과: **test 단계에서 멈춤, 종료코드 1**(1 failed | 327 passed). typecheck·lint·build·vercel은 실행되지 않았습니다. Vercel 배포 목록에도 새 배포가 없었습니다(맨 위는 9e의 c33vt7pvo 그대로).
- 시험 뒤 임시 테스트는 지웠습니다.

**3. 문서**
- `v6/docs/키-갱신.md`(환경변수 바꾼 뒤 다시 배포: Vercel 화면의 Redeploy 대신, 터미널 블록 두 곳)와 `v6/docs/법령-갱신.md`의 배포 명령을 모두 `npm run deploy`로 바꾸고, "실패하면 배포하지 않고 멈춘다"는 한 줄을 붙였습니다.

**4. 마무리**
- 통과 상태에서 `npm run deploy` 1회: 종료코드 0, 테스트 327개 통과 → 타입 검사·린트·빌드 → 배포(kikhan-auto-compass-v6-ivsx8ugmn), 사이트 응답 200.
- 앱 코드는 바꾸지 않았습니다(package.json scripts, 문서, MASTER D-50만).
- force push 없음. 커밋 해시는 채팅 보고에 적습니다.
