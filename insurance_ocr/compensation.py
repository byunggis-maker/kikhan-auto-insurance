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


def estimate_partial_vehicle(damage, expenses, deductible, limit, vehicle_value, allow_incomplete=False):
    values = (damage, expenses, deductible, limit, vehicle_value)
    if allow_incomplete and any(v is None for v in values):
        if type(damage) is not int or damage < 0:
            return None, "추정의 기준이 될 차량 손해액 확인 필요"
        if any(v is not None and (type(v) is not int or v < 0) for v in values):
            return None, "손해액·비용·공제액·한도는 0 이상의 금액이어야 합니다."
        if limit == 0 or vehicle_value == 0:
            return None, "가입한도와 보험가액은 0보다 커야 합니다."
        caps = [damage] + [v for v in (limit, vehicle_value) if v is not None]
        amount = max(min(caps) + (expenses if expenses is not None else 0) - (deductible if deductible is not None else 0), 0)
        pending = []
        for value, reason in ((expenses, "인정 비용 미확정: 추가 비용 미반영"),
                              (deductible, "자기부담금 미확정: 공제 전 금액"),
                              (limit, "가입한도 미확정: 한도 조정 전 금액"),
                              (vehicle_value, "보험가액 미확정: 보험가액 조정 전 금액")):
            if value is None:
                pending.append(reason)
        return amount, "제24조 부분손해·최초 청구를 가정한 일부 입력 기준 추정: 확인된 손해액과 한도·비용·공제액만 반영. " + "; ".join(pending) + ". 미입력 값이 0으로 확정됐다는 뜻이 아니며, 실제 보험금은 증액·감액되거나 지급되지 않을 수 있습니다."
    if any(type(v) is not int or v < 0 for v in values):
        return None, "약관상 인정 손해액·비용·확정 자기부담금·가입한도·보험가액 확인 필요"
    if limit == 0 or vehicle_value == 0:
        return None, "가입한도와 보험가액은 0보다 커야 합니다."
    if damage + expenses >= vehicle_value or damage >= limit:
        return None, "전부손해 또는 가입금액 전액 지급: 자기부담금 미공제 조건 별도 확인 필요"
    amount = max(min(damage, limit, vehicle_value) + expenses - deductible, 0)
    return amount, "제24조: 손해액(가입한도·보험가액 이내) + 인정 비용 - 확정 자기부담금. 비용은 가입금액과 관계없이 보상. 부분손해·최초 청구 기준."
