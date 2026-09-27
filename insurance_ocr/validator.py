from typing import Any, Dict, List

from insurance_ocr.policy_parser import (
    build_coverage_record,
    match_standard_coverage_name,
)


MIN_CONFIDENCE = 0.85


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def validate_coverage(
    coverage: Dict[str, Any],
) -> Dict[str, Any]:
    """
    AI가 읽은 담보 한 건을 검증한다.

    원문은 절대로 임의 수정하지 않는다.
    애매하거나 불완전하면 확인 필요로 표시한다.
    """

    original_name = _text(
        coverage.get("original_coverage_name")
    )

    original_limit = _text(
        coverage.get("original_limit")
    )

    deductible = _text(
        coverage.get("deductible")
    )

    special_conditions = _text(
        coverage.get("special_conditions")
    )

    source_text = _text(
        coverage.get("source_text")
    )

    try:
        confidence = float(
            coverage.get("confidence", 0.0)
        )
    except (TypeError, ValueError):
        confidence = 0.0

    confidence = max(0.0, min(confidence, 1.0))

    reasons: List[str] = []

    if not original_name:
        reasons.append("담보명을 읽지 못했습니다.")

    if not original_limit:
        reasons.append(
            "가입금액 또는 보상한도를 확인해야 합니다."
        )

    if confidence < MIN_CONFIDENCE:
        reasons.append(
            f"이미지 판독 신뢰도가 낮습니다({confidence:.2f})."
        )

    standard_name = match_standard_coverage_name(
        original_name
    )

    if original_name and standard_name is None:
        reasons.append(
            "표준 담보와 자동 매칭되지 않았습니다. "
            "증권 원문을 확인하세요."
        )

    # 원문과 내부 표준명을 동시에 보존한다.
    record = build_coverage_record(
        original_name=original_name,
        original_limit=original_limit,
        deductible=deductible,
        special_conditions=special_conditions,
        source_text=source_text,
        confidence=confidence,
    )

    record["standard_coverage_name"] = standard_name
    record["needs_review"] = (
        bool(reasons)
        or bool(coverage.get("needs_review", False))
    )
    record["review_reasons"] = reasons

    return record


def validate_policy_result(
    result: Dict[str, Any],
) -> Dict[str, Any]:
    """
    보험증권 전체 판독 결과를 검증한다.
    """

    if not isinstance(result, dict):
        raise ValueError(
            "보험증권 판독 결과가 올바른 형식이 아닙니다."
        )

    basic_info = result.get("basic_info", {})
    coverages = result.get("coverages", [])

    if not isinstance(basic_info, dict):
        basic_info = {}

    if not isinstance(coverages, list):
        coverages = []

    validated_coverages = []

    for coverage in coverages:
        if not isinstance(coverage, dict):
            continue

        validated_coverages.append(
            validate_coverage(coverage)
        )

    review_count = sum(
        1
        for item in validated_coverages
        if item.get("needs_review")
    )

    notes = result.get("review_notes", [])

    if not isinstance(notes, list):
        notes = []

    if not validated_coverages:
        notes.append(
            "보험증권에서 담보 정보를 확인하지 못했습니다."
        )

    if review_count:
        notes.append(
            f"{review_count}개 담보는 사용자의 확인이 필요합니다."
        )

    return {
        "basic_info": basic_info,
        "coverages": validated_coverages,
        "document_review_required": (
            bool(result.get("document_review_required", False))
            or review_count > 0
            or not validated_coverages
        ),
        "review_notes": notes,
    }
