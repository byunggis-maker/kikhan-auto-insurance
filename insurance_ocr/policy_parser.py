import re
from typing import Any, Dict, List, Optional


# 보험증권 원문은 보존한다.
# 아래 별칭은 "원문을 바꾸기 위한 것"이 아니라
# 앱 내부에서 어떤 담보인지 연결하기 위한 용도다.
COVERAGE_ALIASES = {
    "대인배상Ⅰ": [
        "대인배상Ⅰ",
        "대인배상I",
        "대인배상1",
        "대인배상 Ⅰ",
        "대인배상 I",
    ],
    "대인배상Ⅱ": [
        "대인배상Ⅱ",
        "대인배상II",
        "대인배상2",
        "대인배상 Ⅱ",
        "대인배상 II",
    ],
    "대물배상": [
        "대물배상",
        "대물",
    ],
    "자기신체사고": [
        "자기신체사고",
        "자손",
    ],
    "자동차상해": [
        "자동차상해",
        "자상",
    ],
    "무보험자동차상해": [
        "무보험자동차상해",
        "무보험차상해",
        "무보험차 상해",
    ],
    "자기차량손해": [
        "자기차량손해",
        "자차",
    ],
}


SENSITIVE_FIELD_WORDS = [
    "주민등록번호",
    "주민번호",
    "계약자",
    "피보험자",
    "성명",
    "주소",
    "상세주소",
    "전화번호",
    "휴대전화",
    "휴대폰",
    "증권번호",
    "계약번호",
]


def normalize_text(value: Any) -> str:
    """비교용 문자열만 정리한다. 보험증권 원문 자체는 변경하지 않는다."""
    if value is None:
        return ""

    text = str(value).strip()
    text = re.sub(r"\s+", "", text)

    return text


def match_standard_coverage_name(
    original_name: str,
) -> Optional[str]:
    """
    보험증권에서 읽은 원문 담보명을 내부 표준 담보와 연결한다.

    중요:
    - original_name은 별도로 그대로 보존한다.
    - 자동차상해와 자기신체사고를 서로 합치지 않는다.
    - 확실히 매칭되지 않으면 None을 반환한다.
    """
    target = normalize_text(original_name)

    if not target:
        return None

    # 긴 명칭부터 비교하여
    # '무보험자동차상해'가 단순 '자동차상해'로 잘못 연결되는 것을 막는다.
    candidates = []

    for standard_name, aliases in COVERAGE_ALIASES.items():
        for alias in aliases:
            candidates.append(
                (
                    len(normalize_text(alias)),
                    standard_name,
                    alias,
                )
            )

    candidates.sort(reverse=True)

    for _, standard_name, alias in candidates:
        if target == normalize_text(alias):
            return standard_name

    return None


def mask_sensitive_value(
    field_name: str,
    value: Any,
) -> Any:
    """
    보상분석에 불필요한 개인정보는 화면/구조화 데이터에서 가린다.
    """
    normalized_field = normalize_text(field_name)

    for sensitive_word in SENSITIVE_FIELD_WORDS:
        if normalize_text(sensitive_word) in normalized_field:
            return "[가림 처리]"

    return value


def parse_amount_to_won(value: Any) -> Optional[int]:
    """
    명확한 금액 표현만 원 단위 정수로 변환한다.

    예:
    5억원 -> 500000000
    2,500만원 -> 25000000
    30000000원 -> 30000000

    '무한', '법정한도'처럼 숫자가 아닌 한도는 None으로 두고
    원문은 별도로 보존한다.
    """
    if value is None:
        return None

    text = str(value).strip().replace(",", "").replace(" ", "")

    if not text:
        return None

    if "무한" in text or "법정한도" in text:
        return None

    match = re.fullmatch(r"([\d.]+)억원?", text)
    if match:
        return int(float(match.group(1)) * 100_000_000)

    match = re.fullmatch(r"([\d.]+)만원?", text)
    if match:
        return int(float(match.group(1)) * 10_000)

    match = re.fullmatch(r"([\d]+)원?", text)
    if match:
        return int(match.group(1))

    return None


def build_coverage_record(
    original_name: str,
    original_limit: Any = None,
    deductible: Any = None,
    special_conditions: Any = None,
    source_text: str = "",
    confidence: Optional[float] = None,
) -> Dict[str, Any]:
    """
    보험증권에서 읽은 '담보명 + 가입금액/조건'을 하나의 레코드로 묶는다.

    original_name과 original_limit은 OCR에서 읽은 원문을 그대로 보존한다.
    """
    standard_name = match_standard_coverage_name(original_name)

    return {
        "original_coverage_name": original_name,
        "standard_coverage_name": standard_name,
        "original_limit": original_limit,
        "limit_amount_won": parse_amount_to_won(original_limit),
        "deductible": deductible,
        "special_conditions": special_conditions,
        "source_text": source_text,
        "confidence": confidence,
        "needs_review": standard_name is None,
    }


def build_policy_result(
    basic_info: Dict[str, Any],
    coverages: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    최종 보험증권 판독 결과 구조를 만든다.
    개인정보 필드는 자동으로 가림 처리한다.
    """
    safe_basic_info = {}

    for key, value in basic_info.items():
        safe_basic_info[key] = mask_sensitive_value(key, value)

    return {
        "basic_info": safe_basic_info,
        "coverages": coverages,
    }
