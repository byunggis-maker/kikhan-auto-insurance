# Streamlit 벤치마킹 및 배포 준비 (2026-10-07)

## 참고 앱과 적용

- [pixegami Mortgage Repayments Calculator](https://github.com/pixegami/streamlit-demo-app/blob/main/mortgage_calculator.py): 입력 영역과 주요 결과 지표를 분리하는 구성을 참고했습니다. 이 앱에는 추정 보험금 총계·총계 중 사용자 임시 입력액·미정 담보 건수의 요약 지표를 적용했습니다. 대출 계산식은 사용하지 않았습니다.
- [Pathway 문서 QA 앱](https://github.com/pathway-labs/realtime-indexer-qa-chat): 문서 기반 입력, 세션 상태 유지, 처리 중 상태 표시라는 흐름을 참고했습니다. 이미 있는 문서 판독·진행 표시를 유지하고, 사용자에게 내부 JSON 대신 증권 원문·확인 사유 표를 보여주도록 개선했습니다. 외부 문서 저장소나 추가 분석 API는 도입하지 않았습니다.

보험금 산정근거 자체를 벤치마킹 앱에서 가져오지 않았습니다. 근거는 이 프로젝트의 약관과 사용자 입력입니다. 화면을 담보별 예상액과 약관·확인 사유 탭으로 나누고 자세한 근거는 펼쳐 확인할 수 있습니다. 음성 변환 함수와 문서 API는 변경하지 않았습니다.

## 배포 구성

[Streamlit Community Cloud 공식 배포 안내](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app)에 따라 Python 3.12, app.py, requirements.txt, packages.txt, .streamlit/config.toml을 준비했습니다. ffmpeg는 정상 음성 경로의 기존 변환용 시스템 의존성입니다. Secrets는 Cloud에서 설정하며 Git에 넣지 않습니다.

원격 main에는 로컬 기준보다 신규 커밋 두 개가 있어 원격 main을 덮어쓰지 않고 별도 streamlit-release-20261007 브랜치를 사용합니다. 기존 Vercel 프로젝트는 변경하지 않습니다.

Cloud 로그인·배포 URL·운영 상태는 실제 성공을 확인한 뒤 기록합니다. 현재 이 문서는 배포 준비 기록입니다.


## 검증 및 현재 진행 상태

- 자동 테스트 7개 통과. 실제 배포용 복제본에서도 같은 테스트 통과.
- Python 컴파일·Git diff 검사 통과. 배포 파일에서 API 키와 환경변수 파일을 제외했고 자격증명 패턴 검사 통과.
- 로컬 브라우저에서 임시 추정액 500,000원 입력 → 총계 500,000원 → 미정 5건 → 담보별 예상액 탭을 확인했습니다.
- 엑셀 데이터 생성·합계·사유 시트는 자동 테스트로 확인했습니다. 실제 브라우저 다운로드 이벤트 검증은 도구 시간 초과로 미검증입니다.
- GitHub streamlit-release-20261007 브랜치 업로드 완료. 기존 main과 Vercel 앱은 변경하지 않았습니다.
- Streamlit Cloud 로그인 확인 및 새 앱 배포 양식 준비. Python 3.12 선택. Secrets 설정 및 Deploy 완료는 아직 확인하지 않았습니다.

## 실제 배포 결과 (2026-10-07)

- 공개 주소: https://kikhan-auto-estimate.streamlit.app/ — 로그인 없는 HTTP 요청 200 및 브라우저 앱 화면 확인.
- 배포 대상: byunggis-maker/kikhan-auto-insurance, streamlit-release-20261007, app.py. Python 3.12 및 기존 OPENAI_API_KEY를 Cloud Secrets에 저장. 키 값은 보고·로그·Git에 포함하지 않음.
- 기존 음성 함수 6개의 변경 없음 검사 포함 자동 테스트 7개 통과. 기존 키를 사용한 합성 JPEG/PNG/HEIC/스캔 PDF/텍스트 PDF 판독 모두 통과(로컬 실제 API 검증).
- 배포 앱에서 사용자 임시 추정액 500,000원, 총계 500,000원, 금액 미정 담보 5건 및 약관·확인 사유 탭 확인.
- 배포 서버 문서 업로드는 브라우저 확장 파일 접근 권한 거부로 미검증. 실제 마이크 음성 전사와 실제 Excel 다운로드 완료도 미검증(버튼 실행 및 Excel 생성·합계 자동 테스트는 확인).
