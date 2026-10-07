# 기칸의 자동차보험 보상 나침반

사고 후 증권·가입정보와 사용자가 입력한 손해액을 바탕으로 보험금을 추정하는 Streamlit 앱입니다.

1. 사고내용을 녹음하거나 직접 입력합니다.
2. 보험증권·가입증명서 PDF/JPEG/PNG/HEIC를 읽고 가입정보를 수정합니다.
3. 담보별 추정액과 약관·확인 사유를 확인하고 엑셀로 내려받습니다.

자동 계산 가능한 조건부 추정액과 사용자 입력 임시 추정액을 총계에 포함합니다. 금액을 정할 수 없는 항목은 사유와 함께 **미정**으로 표시합니다. 중복 지급 조정 전의 단순 합산이며 실제 보험사 지급액과 다를 수 있습니다. 자동 산정은 현재 검증한 개인용 자기차량손해 부분손해 수식에 한정됩니다.

## 로컬 실행

Python 3.12와 ffmpeg를 설치한 뒤:

```bash
python -m pip install -r requirements.txt
streamlit run app.py
```

API 키는 환경변수 또는 `.streamlit/secrets.toml`에서 읽으며 Git에 넣지 않습니다.

## Streamlit Community Cloud 배포

- 저장소: `byunggis-maker/kikhan-auto-insurance`
- 배포 브랜치: `streamlit-release-20261007`
- 실행 파일: `app.py`
- Advanced settings: Python 3.12
- Secrets: `OPENAI_API_KEY`를 설정합니다. 실제 값은 저장소에 기록하지 않습니다.
- `packages.txt`의 ffmpeg는 기존 음성 형식 변환에 사용합니다.
- `requirements.txt`는 검증한 버전으로 고정했습니다.

배포 후 앱 열기, 음성 입력, PDF/JPEG/HEIC 판독, 임시 추정액·미정 사유·엑셀 다운로드를 확인합니다. 원격에서 확인하지 못한 기능은 미검증으로 기록합니다.

벤치마킹과 검증 기록: [reports/streamlit_benchmark.md](reports/streamlit_benchmark.md), [reports/stage_b_validation.md](reports/stage_b_validation.md).
