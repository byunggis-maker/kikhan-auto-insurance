"""Optional paid API smoke test using synthetic documents; never prints credentials.
Run: python tests/live_document_check.py
"""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
from test_document_recovery import samples
from insurance_ocr.image_reader import read_policy_document
from insurance_ocr.validator import validate_policy_result


def main():
    load_dotenv(ROOT / ".env")
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        print("미검증: 문서 API 키를 사용할 수 없습니다.")
        return 2
    failed = False
    for filename, data in samples().items():
        try:
            doc = validate_policy_result(read_policy_document(data, filename, key))
            matched = [c for c in doc["coverages"] if c.get("standard_coverage_name") == "자기차량손해"]
            passed = any(c.get("limit_amount_won") == 20000000 and not c.get("needs_review") for c in matched)
            print(filename, "통과" if passed else "확인 필요")
            failed |= not passed
        except Exception:
            print(filename, "미검증: 연결·키 권한·변환 라이브러리 확인 필요")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
