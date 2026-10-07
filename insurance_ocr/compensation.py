"""Only calculate a formula whose source and required inputs are verified."""
from pathlib import Path
import hashlib
import unicodedata


def verified_vehicle_rule(root):
    for path in (Path(root) / "data/raw/policies").glob("*.pdf"):
        if unicodedata.normalize("NFC", path.name) == "개인용 약관.pdf":
            if hashlib.sha256(path.read_bytes()).hexdigest() == "67dc9455b0760dfbb8f0988ad975d33c81a9630888bf83bad99291fc0f3e5262":
                return path
    return None


def estimate_partial_vehicle(damage, expenses, deductible, limit, vehicle_value):
    values = (damage, expenses, deductible, limit, vehicle_value)
    if any(type(v) is not int or v < 0 for v in values):
        return None, "약관상 인정 손해액·비용·확정 자기부담금·가입한도·보험가액 확인 필요"
    if limit == 0 or vehicle_value == 0:
        return None, "가입한도와 보험가액은 0보다 커야 합니다."
    if damage + expenses >= vehicle_value or damage >= limit:
        return None, "전부손해 또는 가입금액 전액 지급: 자기부담금 미공제 조건 별도 확인 필요"
    amount = max(min(damage, limit, vehicle_value) + expenses - deductible, 0)
    return amount, "제24조: 손해액(가입한도·보험가액 이내) + 인정 비용 - 확정 자기부담금. 비용은 가입금액과 관계없이 보상. 부분손해·최초 청구 기준."
