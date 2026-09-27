import base64
import json
import mimetypes
import os
from pathlib import Path
from typing import Any, Dict

from openai import OpenAI


POLICY_READER_PROMPT = """
당신은 대한민국 자동차보험 보험증권 판독 보조 시스템이다.

제공된 자동차보험 증권 이미지를 자세히 읽고,
보험증권에 실제로 인쇄되어 있는 담보명과 가입금액/보상한도/조건을
가능한 한 원문 그대로 추출하라.

[절대 원칙]

1. 보험증권에 없는 담보를 추측하여 추가하지 않는다.
2. 읽을 수 없는 글자는 임의로 만들어내지 않는다.
3. 불확실하면 빈 문자열로 두고 needs_review를 true로 한다.
4. 담보명은 보험증권에 표시된 명칭을 그대로 original_coverage_name에 기록한다.
5. 가입금액과 보상한도 역시 원문 표현을 original_limit에 그대로 기록한다.
6. 자동차상해와 자기신체사고를 임의로 같은 담보로 취급하지 않는다.
7. 무보험자동차상해를 자동차상해로 잘못 분류하지 않는다.
8. 자기차량손해의 자기부담금 조건이 보이면 별도로 기록한다.
9. 특약명이 보이면 생략하지 말고 각각 별도의 담보 또는 특약으로 기록한다.
10. 동일 담보라도 증권에 여러 줄로 구분되어 있으면 정보를 잃지 않는다.

[개인정보 보호]

다음 항목의 실제 값은 출력하지 말고 반드시 "[가림 처리]"라고 기록한다.

- 계약자 성명
- 피보험자 성명
- 주민등록번호
- 상세 주소
- 전화번호
- 휴대전화번호
- 보험증권번호
- 계약번호

차량번호는 전체 번호를 그대로 출력하지 말고 일부를 가려라.
예: 12가3456 -> 12가**56

[추출할 기본 정보]

- 보험회사
- 보험상품명
- 보험종류
- 보험기간
- 차량종류
- 차량번호(부분 가림)
- 기타 보상분석에 필요한 비민감 계약정보

[담보별 추출 정보]

각 담보마다 다음을 기록한다.

- original_coverage_name
- original_limit
- deductible
- special_conditions
- source_text
- confidence
- needs_review

confidence는 0.0~1.0 숫자로 표시한다.

반드시 아래 JSON 형식만 출력한다.
설명문이나 Markdown 코드블록은 출력하지 않는다.

{
  "basic_info": {
    "보험회사": "",
    "보험상품명": "",
    "보험종류": "",
    "보험기간": "",
    "차량종류": "",
    "차량번호": ""
  },
  "coverages": [
    {
      "original_coverage_name": "",
      "original_limit": "",
      "deductible": "",
      "special_conditions": "",
      "source_text": "",
      "confidence": 0.0,
      "needs_review": false
    }
  ],
  "document_review_required": false,
  "review_notes": []
}
"""


def _image_to_data_url(image_path: str) -> str:
    path = Path(image_path)

    if not path.exists():
        raise FileNotFoundError(f"이미지 파일을 찾을 수 없습니다: {path}")

    mime_type, _ = mimetypes.guess_type(str(path))

    if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError(
            "지원하는 이미지 형식은 JPG, JPEG, PNG, WEBP입니다."
        )

    encoded = base64.b64encode(path.read_bytes()).decode("utf-8")

    return f"data:{mime_type};base64,{encoded}"


def _clean_json_text(text: str) -> str:
    text = text.strip()

    if text.startswith("```"):
        lines = text.splitlines()

        if lines:
            lines = lines[1:]

        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]

        text = "\n".join(lines).strip()

        if text.lower().startswith("json"):
            text = text[4:].lstrip()

    return text


def read_policy_image(
    image_path: str,
    api_key: str = "",
) -> Dict[str, Any]:
    """
    자동차보험 증권 이미지를 OpenAI Vision으로 판독한다.

    반환값:
        basic_info
        coverages
        document_review_required
        review_notes
    """

    key = (api_key or os.getenv("OPENAI_API_KEY", "")).strip()

    if not key:
        raise RuntimeError(
            "OPENAI_API_KEY가 설정되어 있지 않습니다."
        )

    client = OpenAI(api_key=key)

    data_url = _image_to_data_url(image_path)

    response = client.responses.create(
        model="gpt-5.6-luna",
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": POLICY_READER_PROMPT,
                    },
                    {
                        "type": "input_image",
                        "image_url": data_url,
                        "detail": "high",
                    },
                ],
            }
        ],
    )

    raw_text = _clean_json_text(response.output_text)

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            "보험증권 판독 결과를 JSON으로 변환하지 못했습니다."
        ) from exc

    if not isinstance(result, dict):
        raise RuntimeError(
            "보험증권 판독 결과 형식이 올바르지 않습니다."
        )

    result.setdefault("basic_info", {})
    result.setdefault("coverages", [])
    result.setdefault("document_review_required", False)
    result.setdefault("review_notes", [])

    return result
