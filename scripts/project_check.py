from pathlib import Path
import py_compile
import sys

ROOT = Path(__file__).resolve().parents[1]

CHECKS = {
    "메인 앱": ROOT / "app.py",
    "보험증권 이미지 판독": ROOT / "insurance_ocr" / "image_reader.py",
    "보험증권 담보 파서": ROOT / "insurance_ocr" / "policy_parser.py",
    "보험증권 검증": ROOT / "insurance_ocr" / "validator.py",
    "약관 규칙 데이터": ROOT / "data" / "processed" / "policy_rules.json",
    "개인용 약관": ROOT / "data" / "raw" / "policies" / "개인용 약관.pdf",
    "업무용 약관": ROOT / "data" / "raw" / "policies" / "업무용 약관.pdf",
    "영업용 약관": ROOT / "data" / "raw" / "policies" / "영업용 약관.pdf",
    "이륜차 약관": ROOT / "data" / "raw" / "policies" / "이륜차 약관.pdf",
}

print("=== 기칸 자동차보험 앱 전체 구조 점검 ===")
failed = False
for label, path in CHECKS.items():
    ok = path.exists()
    print(f"{'✅' if ok else '❌'} {label}: {path.relative_to(ROOT)}")
    failed = failed or not ok

print("\n=== Python 문법 점검 ===")
for rel in [
    "app.py",
    "insurance_ocr/image_reader.py",
    "insurance_ocr/policy_parser.py",
    "insurance_ocr/validator.py",
    "services/law_api.py",
]:
    path = ROOT / rel
    try:
        py_compile.compile(str(path), doraise=True)
        print(f"✅ {rel}")
    except Exception as exc:
        failed = True
        print(f"❌ {rel}: {exc}")

app_text = (ROOT / "app.py").read_text(encoding="utf-8")
print("\n=== 핵심 기능 연결 점검 ===")
for label, token in [
    ("음성 사고내용 입력", "st.audio_input"),
    ("보험증권 카메라", "st.camera_input"),
    ("보험증권 사진 업로드", "st.file_uploader"),
    ("보험증권 AI 판독 호출", "read_policy_image("),
    ("보험증권 검증 호출", "validate_policy_result("),
    ("사고내용 전제조건 연결", "infer_accident_preconditions"),
]:
    ok = token in app_text
    print(f"{'✅' if ok else '❌'} {label}")
    failed = failed or not ok

print("\n결과:", "❌ 확인 필요" if failed else "✅ 구조 및 문법 기본 점검 통과")
sys.exit(1 if failed else 0)
