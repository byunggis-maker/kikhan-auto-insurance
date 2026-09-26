import hashlib
import json
import os
import re
import subprocess
import tempfile
import warnings
from html import escape
from pathlib import Path

import requests
import streamlit as st
from dotenv import load_dotenv


# =========================================================
# 기본 설정
# =========================================================

PROJECT_ROOT = Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")

warnings.filterwarnings(
    "ignore",
    message="urllib3 v2 only supports OpenSSL 1.1.1+.*",
    category=Warning,
)

st.set_page_config(
    page_title="기칸의 자동차보험 보상 나침반",
    page_icon="🧭",
    layout="centered",
)


# =========================================================
# 선택 항목
# =========================================================

USER_POSITIONS = [
    "피해자",
    "사고를 낸 운전자 또는 피보험자",
    "쌍방과실 사고 당사자",
    "아직 판단하기 어려움",
]

INSURANCE_TYPE_OPTIONS = [
    "개인용 자동차보험",
    "업무용 자동차보험",
    "영업용 자동차보험",
    "이륜차 자동차보험",
]

FAULT_RATE_OPTIONS = [
    "아직 정해지지 않음",
    "0%",
    "10%",
    "20%",
    "30%",
    "40%",
    "50%",
    "60%",
    "70%",
    "80%",
    "90%",
    "100%",
    "직접 입력",
]

INJURY_GRADE_OPTIONS = [
    "해당 없음",
    "아직 확인되지 않음",
    "1급",
    "2급",
    "3급",
    "4급",
    "5급",
    "6급",
    "7급",
    "8급",
    "9급",
    "10급",
    "11급",
    "12급",
    "13급",
    "14급",
]

# 약관 PDF에서 확인된 담보명과 특약명만 사용합니다.
# PDF에 근거가 없는 임의의 보상한도, 자기부담금 옵션은 제거했습니다.
COVERAGES_BY_TYPE = {
    "개인용 자동차보험": [
        "대인배상Ⅰ",
        "대인배상Ⅱ",
        "대물배상",
        "자기신체사고",
        "무보험자동차에의한상해",
        "자기차량손해",
        "운전자한정 특약",
        "연령한정 특약",
        "기명피보험자 1인한정 특약",
        "부부한정 특약",
        "가족한정 특약",
        "단기 운전자확대 특약",
    ],
    "업무용 자동차보험": [
        "대인배상Ⅰ",
        "대인배상Ⅱ",
        "대물배상",
        "자기신체사고",
        "무보험자동차에의한상해",
        "자기차량손해",
        "운전자한정 특약",
        "연령한정 특약",
        "기명피보험자 1인한정 특약",
        "부부한정 특약",
        "가족한정 특약",
        "단기 운전자확대 특약",
    ],
    "영업용 자동차보험": [
        "대인배상Ⅰ",
        "대인배상Ⅱ",
        "대물배상",
        "자기신체사고",
        "무보험자동차에의한상해",
        "자기차량손해",
        "운전자한정 특약",
        "연령한정 특약",
        "기명피보험자 1인한정 특약",
        "부부한정 특약",
        "가족한정 특약",
        "단기 운전자확대 특약",
    ],
    "이륜차 자동차보험": [
        "대인배상Ⅰ",
        "대인배상Ⅱ",
        "대물배상",
        "자기신체사고",
        "무보험자동차에의한상해",
        "자기차량손해",
        "운전자한정 특약",
        "연령한정 특약",
        "기명피보험자 1인한정 특약",
        "부부한정 특약",
        "가족한정 특약",
        "단기 운전자확대 특약",
    ],
}

COVERAGE_CODES = {
    "대인배상Ⅰ": "d1",
    "대인배상Ⅱ": "d2",
    "대물배상": "d3",
    "자기신체사고": "d4",
    "무보험자동차에의한상해": "d5",
    "자기차량손해": "d6",
    "운전자한정 특약": "x1",
    "연령한정 특약": "x2",
    "기명피보험자 1인한정 특약": "x3",
    "부부한정 특약": "x4",
    "가족한정 특약": "x5",
    "단기 운전자확대 특약": "x6",
}

COST_FIELD_CODES = {
    "치료비": "treat_total",
    "수술비": "surgery",
    "입원비": "inpatient",
    "통원치료비": "outpatient",
    "휴업손해": "lost_income",
    "차량수리비": "repair_cost",
    "견인비": "towing_cost",
    "대차료 또는 교통비": "rental_cost",
    "기타 재산손해": "property_damage",
}


# =========================================================
# 화면 디자인
# =========================================================

st.markdown(
    """
    <style>
    html, body, [data-testid="stAppViewContainer"] {
        background: #ffffff;
        color: #111111;
    }

    .stApp {
        max-width: 1080px;
        margin: 0 auto;
    }

    .block-container {
        padding-top: 2rem;
        padding-bottom: 3rem;
    }

    h1, h2, h3, p, label, .stMarkdown {
        color: #111111;
    }

    div[data-testid="stAlert"] {
        background: #ffffff;
        color: #111111;
        border: 1px solid #333333;
        border-radius: 10px;
    }

    .stTextInput input,
    .stTextArea textarea,
    .stNumberInput input,
    .stSelectbox div[data-baseweb="select"] > div {
        background: #ffffff !important;
        color: #111111 !important;
        border: 1px solid #d0d7de !important;
        border-radius: 8px !important;
        box-shadow: none !important;
    }
    input[type="number"]::-webkit-outer-spin-button,
    input[type="number"]::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }
    input[type="number"] {
        -moz-appearance: textfield;
    }
    .white-excel-table {
        width: 100%;
        border-collapse: collapse;
        overflow-x: auto;
        display: block;
        white-space: normal;
        border: 1px solid #dfe3e8;
        border-radius: 10px;
    }
    .white-excel-table th,
    .white-excel-table td {
        border: 1px solid #dfe3e8;
        padding: 0.55rem 0.7rem;
        text-align: left;
        vertical-align: top;
        color: #111111;
        background: #ffffff;
    }
    .white-excel-table th {
        background: #eef3f8;
        font-weight: 700;
    }
    .white-excel-table td.numeric {
        text-align: right;
    }

    div[data-testid="stAudioInput"] {
        background: #ffffff !important;
        border: 1px solid #111111;
        border-radius: 12px;
        padding: 0.55rem 0.7rem;
    }

    div[data-testid="stAudioInput"] button {
        background: #ffffff !important;
        color: #111111 !important;
        border: 1px solid #111111 !important;
        border-radius: 50% !important;
    }

    div[data-testid="stAudioInput"] button svg {
        color: #111111 !important;
        fill: #111111 !important;
    }

    div.stButton > button,
    div[data-testid="stFormSubmitButton"] > button {
        width: 100%;
        background: #111111 !important;
        color: #ffffff !important;
        border: 1px solid #111111 !important;
        border-radius: 10px;
        font-weight: 700;
        padding: 0.72rem 1rem;
    }

    div.stButton > button:hover,
    div[data-testid="stFormSubmitButton"] > button:hover {
        background: #000000 !important;
        color: #ffffff !important;
    }

    div.stButton > button p,
    div[data-testid="stFormSubmitButton"] > button p {
        color: #ffffff !important;
    }
    
    /* Streamlit 상단 검은 영역 제거 */
    header[data-testid="stHeader"] {
        display: none !important;
        height: 0 !important;
    }

    div[data-testid="stToolbar"] {
        display: none !important;
    }

    div[data-testid="stDecoration"] {
        display: none !important;
    }

    .block-container {
        padding-top: 1.2rem !important;
    }
</style>
    """,
    unsafe_allow_html=True,
)


# =========================================================
# 공통 함수
# =========================================================


def make_storage_key(value):
    return re.sub(
        r"[^0-9A-Za-z가-힣]+",
        "_",
        str(value),
    ).strip("_").lower()


def get_amount_options(coverage_name):
    return [
        "직접 입력",
    ]


def get_deductible_options(coverage_name):
    return [
        "직접 입력",
    ]


def get_openai_key():
    try:
        secret_key = str(
            st.secrets.get(
                "OPENAI_API_KEY",
                "",
            )
        ).strip()
    except Exception:
        secret_key = ""

    return (
        secret_key
        or os.getenv(
            "OPENAI_API_KEY",
            "",
        ).strip()
        or None
    )


def safe_audio_metadata(recorded_audio):
    original_name = str(
        getattr(
            recorded_audio,
            "name",
            "",
        )
        or ""
    ).strip()

    original_type = str(
        getattr(
            recorded_audio,
            "type",
            "",
        )
        or ""
    ).strip()

    mime_type = (
        original_type.split(
            ";",
            1,
        )[0].lower()
        or "audio/wav"
    )

    extension_map = {
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/webm": ".webm",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
        "audio/ogg": ".ogg",
    }

    suffix = Path(
        original_name
    ).suffix.lower()

    if suffix not in {
        ".wav",
        ".mp3",
        ".webm",
        ".m4a",
        ".ogg",
        ".mp4",
    }:
        suffix = extension_map.get(
            mime_type,
            ".wav",
        )

    return (
        f"accident_audio{suffix}",
        mime_type,
    )


def normalize_audio_to_wav(audio_bytes, mime_type="audio/wav"):
    if not audio_bytes:
        raise RuntimeError("녹음된 음성 데이터가 비어 있습니다.")

    if audio_bytes.startswith(b"RIFF"):
        return audio_bytes, "audio/wav"

    if mime_type not in {"audio/webm", "audio/ogg", "audio/m4a", "audio/mp4", "audio/mpeg", "audio/mp3"}:
        return audio_bytes, mime_type

    with tempfile.NamedTemporaryFile(suffix=".input") as src, tempfile.NamedTemporaryFile(suffix=".wav") as dst:
        src.write(audio_bytes)
        src.flush()

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            src.name,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "wav",
            dst.name,
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            check=False,
        )

        if result.returncode != 0:
            stderr = (result.stderr or b"").decode("utf-8", errors="replace")
            raise RuntimeError(
                "브라우저 녹음 파일을 변환하지 못했습니다. "
                "다시 녹음하거나 WAV 형식으로 저장한 뒤 다시 시도해 주세요."
                f"{(' ' + stderr[:200]) if stderr else ''}"
            )

        wav_bytes = dst.read()

    return wav_bytes, "audio/wav"


def transcribe_audio(
    audio_bytes,
    file_name,
    mime_type,
):
    api_key = get_openai_key()

    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY가 설정되지 않았습니다. "
            "로컬은 .env, 공개 앱은 "
            "Streamlit Secrets를 확인해 주세요."
        )

    normalized_audio, normalized_mime = normalize_audio_to_wav(
        audio_bytes,
        mime_type,
    )
    safe_file_name = Path(file_name).stem + ".wav"

    if (
        not normalized_audio
        or len(normalized_audio) < 800
    ):
        raise RuntimeError(
            "녹음 내용이 너무 짧습니다. "
            "2초 이상 말한 뒤 녹음을 종료해 주세요."
        )

    try:
        response = requests.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={
                "Authorization": (
                    f"Bearer {api_key}"
                )
            },
            files={
                "file": (
                    safe_file_name,
                    normalized_audio,
                    normalized_mime,
                )
            },
            data={
                "model": "gpt-4o-mini-transcribe",
                "language": "ko",
                "response_format": "json",
            },
            timeout=(15, 150),
        )

    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            "변환 서버 응답이 지연되었습니다. "
            "같은 녹음으로 다시 시도해 주세요."
        ) from exc

    except requests.exceptions.RequestException as exc:
        raise RuntimeError(
            "음성 변환 서버에 연결하지 못했습니다. "
            "인터넷 연결을 확인해 주세요."
        ) from exc

    if not response.ok:
        try:
            error_data = response.json().get(
                "error",
                {},
            )

            error_message = str(
                error_data.get(
                    "message",
                    "",
                )
            ).strip()

        except Exception:
            error_message = response.text[:400]

        safe_message = re.sub(
            r"sk-[A-Za-z0-9_-]{10,}",
            "[API_KEY_REDACTED]",
            error_message,
        ).replace(
            "\n",
            " ",
        ).strip()

        lowered = safe_message.lower()

        if (
            response.status_code == 401
            or "invalid_api_key" in lowered
        ):
            raise RuntimeError(
                "API 키 인증에 실패했습니다. "
                "키 저장 위치를 확인해 주세요."
            )

        if response.status_code == 429:
            raise RuntimeError(
                "API 사용 한도 또는 "
                "요청 한도를 확인해 주세요."
            )

        if response.status_code == 413:
            raise RuntimeError(
                "녹음 파일이 너무 큽니다. "
                "더 짧게 녹음해 주세요."
            )

        raise RuntimeError(
            "음성 변환 요청이 거절되었습니다. "
            f"상태번호 {response.status_code}: "
            f"{safe_message or '상세 원인을 확인하지 못했습니다.'}"
        )

    try:
        result = response.json()

    except ValueError as exc:
        raise RuntimeError(
            "변환 결과를 읽지 못했습니다. "
            "같은 녹음으로 다시 시도해 주세요."
        ) from exc

    transcript = str(
        result.get(
            "text",
            "",
        )
    ).strip()

    if not transcript:
        raise RuntimeError(
            "말소리를 확인하지 못했습니다. "
            "마이크에 가까이 대고 다시 녹음해 주세요."
        )

    return transcript


def infer_related_coverages(selected_coverages, question_text):
    question = (question_text or "").lower()
    if not selected_coverages:
        return ["관련 담보 확인 필요"]

    selected_names = [item.get("담보명") for item in selected_coverages]
    injury_keywords = ["치료", "부상", "입원", "통원", "수술", "후유장해", "휴업", "소득", "상해"]
    vehicle_keywords = ["수리", "차량", "견인", "대차", "교통", "손상", "파손"]
    property_keywords = ["물건", "대물", "파손", "창문", "타이어"]

    if any(keyword in question for keyword in injury_keywords):
        candidates = [name for name in selected_names if name in {"대인배상Ⅰ", "대인배상Ⅱ", "자기신체사고", "무보험자동차에의한상해"}]
        return candidates or ["관련 담보 확인 필요"]

    if any(keyword in question for keyword in vehicle_keywords):
        candidates = [name for name in selected_names if name == "자기차량손해"]
        if candidates:
            return candidates
        return ["관련 담보 확인 필요"]

    if any(keyword in question for keyword in property_keywords):
        candidates = [name for name in selected_names if name == "대물배상"]
        if candidates:
            return candidates
        return ["관련 담보 확인 필요"]

    return selected_names[:1] if selected_names else ["관련 담보 확인 필요"]


def normalize_policy_search_text(value):
    return re.sub(
        r"[^0-9A-Za-z가-힣ⅠⅡ]+",
        "",
        str(value or ""),
    ).lower()


POLICY_COVERAGE_ALIASES = {
    "대인배상Ⅰ": [
        "대인배상Ⅰ",
        "대인배상1",
        "대인1",
        "대인 일",
    ],
    "대인배상Ⅱ": [
        "대인배상Ⅱ",
        "대인배상2",
        "대인2",
        "대인 이",
    ],
    "대물배상": [
        "대물배상",
        "대물",
        "차량수리",
        "상대 차량 손해",
    ],
    "자기신체사고": [
        "자기신체사고",
        "자손",
        "본인 치료비",
    ],
    "무보험자동차에의한상해": [
        "무보험자동차에의한상해",
        "무보험자동차상해",
        "무보험차상해",
        "무보험차 상해",
        "무보험 차량 상해",
        "무보험",
    ],
    "자기차량손해": [
        "자기차량손해",
        "자차",
        "자차보험",
        "내 차 수리",
    ],
    "운전자한정 특약": [
        "운전자한정",
        "운전자 한정",
        "운전자 범위",
    ],
    "연령한정 특약": [
        "연령한정",
        "연령 한정",
        "운전자 나이",
    ],
}


def detect_requested_coverage(question_text):
    normalized_question = normalize_policy_search_text(
        question_text
    )

    matches = []

    for coverage_name, aliases in POLICY_COVERAGE_ALIASES.items():
        for alias in aliases:
            normalized_alias = normalize_policy_search_text(
                alias
            )

            if (
                normalized_alias
                and normalized_alias in normalized_question
            ):
                matches.append(
                    (
                        len(normalized_alias),
                        coverage_name,
                    )
                )

    if not matches:
        return None

    matches.sort(
        reverse=True
    )

    return matches[0][1]


def get_question_search_terms(question_text, coverage_name=None):
    terms = []

    if coverage_name:
        terms.append(
            coverage_name
        )

        terms.extend(
            POLICY_COVERAGE_ALIASES.get(
                coverage_name,
                [],
            )
        )

    stop_words = {
        "약관",
        "규정",
        "내용",
        "알려줘",
        "알려주세요",
        "설명",
        "설명해줘",
        "어떻게",
        "경우",
        "관련",
        "대한",
        "좀",
    }

    for token in re.findall(
        r"[0-9A-Za-z가-힣ⅠⅡ]{2,}",
        str(question_text or ""),
    ):
        if token not in stop_words:
            terms.append(token)

    unique_terms = []
    seen = set()

    for term in terms:
        normalized = normalize_policy_search_text(
            term
        )

        if not normalized or normalized in seen:
            continue

        seen.add(normalized)
        unique_terms.append(term)

    return unique_terms


def normalize_extracted_pdf_text(raw_text):
    if not raw_text:
        return ""

    lines = [
        line.rstrip()
        for line in str(raw_text).splitlines()
    ]

    cleaned_lines = []
    vertical_fragments = []

    def is_vertical_fragment(value):
        stripped = value.strip()

        if not stripped:
            return False

        return bool(
            re.fullmatch(
                r"[0-9A-Za-z가-힣ⅠⅡ]{1,2}",
                stripped,
            )
        )

    def flush_vertical_fragments():
        nonlocal vertical_fragments

        if not vertical_fragments:
            return

        if len(vertical_fragments) >= 3:
            joined = "".join(
                fragment.strip()
                for fragment in vertical_fragments
            )

            cleaned_lines.append(
                joined
            )
        else:
            cleaned_lines.extend(
                vertical_fragments
            )

        vertical_fragments = []

    for line in lines:
        stripped = line.strip()

        if is_vertical_fragment(
            stripped
        ):
            vertical_fragments.append(
                stripped
            )
            continue

        flush_vertical_fragments()

        if not stripped:
            if (
                cleaned_lines
                and cleaned_lines[-1] != ""
            ):
                cleaned_lines.append("")
            continue

        cleaned_lines.append(
            stripped
        )

    flush_vertical_fragments()

    result = "\n".join(
        cleaned_lines
    )

    result = re.sub(
        r"\n{3,}",
        "\n\n",
        result,
    )

    return result.strip()


def find_policy_original_in_pdfs(
    question_text,
    insurance_type=None,
):
    try:
        from pypdf import PdfReader
    except ImportError:
        return {
            "원문": "",
            "PDF": "",
            "페이지": "",
            "오류": "PDF 검색 기능에 필요한 pypdf가 설치되지 않았습니다.",
        }

    coverage_name = detect_requested_coverage(
        question_text
    )

    search_terms = get_question_search_terms(
        question_text,
        coverage_name,
    )

    normalized_terms = [
        normalize_policy_search_text(term)
        for term in search_terms
        if normalize_policy_search_text(term)
    ]

    pdf_paths = sorted(
        PROJECT_ROOT.rglob("*.pdf")
    )

    if not pdf_paths:
        return {
            "원문": "",
            "PDF": "",
            "페이지": "",
            "관련 담보": coverage_name or "확인 필요",
            "오류": "프로젝트 폴더에서 자동차보험 약관 PDF를 찾지 못했습니다.",
        }

    insurance_tokens = [
        token
        for token in re.findall(
            r"[가-힣A-Za-z0-9]{2,}",
            str(insurance_type or ""),
        )
        if token not in {
            "자동차보험",
            "보험",
        }
    ]

    normalized_coverage_names = {
        name: normalize_policy_search_text(name)
        for name in POLICY_COVERAGE_ALIASES
    }

    def pdf_priority(pdf_path):
        normalized_name = normalize_policy_search_text(
            pdf_path.name
        )

        score = 0

        for token in insurance_tokens:
            normalized_token = normalize_policy_search_text(
                token
            )
            if normalized_token in normalized_name:
                score += 20

        return score

    pdf_paths.sort(
        key=pdf_priority,
        reverse=True,
    )

    best_candidate = None

    for pdf_path in pdf_paths:
        try:
            reader = PdfReader(
                str(pdf_path)
            )
        except Exception:
            continue

        extracted_pages = []

        for page in reader.pages:
            try:
                try:
                    raw_page_text = page.extract_text(
                        extraction_mode="layout"
                    )
                except TypeError:
                    raw_page_text = page.extract_text()

                page_text = normalize_extracted_pdf_text(
                    raw_page_text
                    or ""
                )
            except Exception:
                page_text = ""

            extracted_pages.append(
                page_text
            )

        for page_index, page_text in enumerate(
            extracted_pages
        ):
            if not page_text:
                continue

            normalized_page = normalize_policy_search_text(
                page_text
            )

            score = pdf_priority(
                pdf_path
            )

            coverage_names_on_page = []

            for name, normalized_name in normalized_coverage_names.items():
                if normalized_name and normalized_name in normalized_page:
                    coverage_names_on_page.append(
                        name
                    )

            if coverage_name:
                canonical = normalize_policy_search_text(
                    coverage_name
                )

                aliases = [
                    normalize_policy_search_text(alias)
                    for alias in POLICY_COVERAGE_ALIASES.get(
                        coverage_name,
                        [],
                    )
                ]

                matched_aliases = [
                    alias
                    for alias in aliases
                    if alias and alias in normalized_page
                ]

                if (
                    canonical not in normalized_page
                    and not matched_aliases
                ):
                    continue

                if canonical in normalized_page:
                    score += 150

                score += len(
                    matched_aliases
                ) * 20

                if "보상하는손해" in normalized_page:
                    score += 100

                if "피보험자" in normalized_page:
                    score += 40

                if "보험금" in normalized_page:
                    score += 30

                if "제1조" in normalized_page:
                    score += 50

                if "목차" in normalized_page:
                    score -= 200

                if len(
                    coverage_names_on_page
                ) > 1:
                    score -= (
                        len(
                            coverage_names_on_page
                        )
                        - 1
                    ) * 80

            else:
                term_hits = 0

                for term in normalized_terms:
                    if term in normalized_page:
                        term_hits += 1

                if term_hits == 0:
                    continue

                score += term_hits * 10

            candidate = {
                "점수": score,
                "PDF경로": pdf_path,
                "PDF명": pdf_path.name,
                "시작페이지": page_index,
                "전체페이지": extracted_pages,
            }

            if (
                best_candidate is None
                or candidate["점수"]
                > best_candidate["점수"]
            ):
                best_candidate = candidate

    if not best_candidate:
        return {
            "원문": "",
            "PDF": "",
            "페이지": "",
            "관련 담보": coverage_name or "확인 필요",
            "오류": (
                "등록된 약관 PDF에서 질문과 일치하는 "
                "약관 조항을 찾지 못했습니다."
            ),
        }

    start_page = best_candidate[
        "시작페이지"
    ]

    all_pages = best_candidate[
        "전체페이지"
    ]

    collected_pages = []

    max_end = min(
        len(all_pages),
        start_page + 15,
    )

    for page_index in range(
        start_page,
        max_end,
    ):
        page_text = all_pages[
            page_index
        ]

        if not page_text:
            continue

        normalized_page = normalize_policy_search_text(
            page_text
        )

        if (
            page_index > start_page
            and coverage_name
        ):
            beginning = normalized_page[
                :700
            ]

            next_coverage_found = False

            for other_name, normalized_name in normalized_coverage_names.items():
                if other_name == coverage_name:
                    continue

                if (
                    normalized_name
                    and normalized_name in beginning
                    and (
                        "보상하는손해" in beginning
                        or "제1조" in beginning
                        or "제1절" in beginning
                    )
                ):
                    next_coverage_found = True
                    break

            if next_coverage_found:
                break

        collected_pages.append(
            (
                page_index + 1,
                page_text,
            )
        )

    if not collected_pages:
        return {
            "원문": "",
            "PDF": best_candidate[
                "PDF명"
            ],
            "페이지": start_page + 1,
            "관련 담보": coverage_name or "확인 필요",
            "오류": "관련 페이지에서 읽을 수 있는 약관 원문을 찾지 못했습니다.",
        }

    full_original_text = []

    for page_number, page_text in collected_pages:
        full_original_text.append(
            f"[PDF {page_number}쪽]\n\n{page_text}"
        )

    first_page = collected_pages[0][0]
    last_page = collected_pages[-1][0]

    if first_page == last_page:
        page_display = str(
            first_page
        )
    else:
        page_display = (
            f"{first_page}~{last_page}"
        )

    return {
        "관련 담보": coverage_name or "질문 내용 기준 검색",
        "원문": "\n\n━━━━━━━━━━━━━━━━━━━━\n\n".join(
            full_original_text
        ),
        "PDF": best_candidate[
            "PDF명"
        ],
        "페이지": page_display,
        "오류": "",
    }

def find_policy_original_in_rules(
    question_text,
    insurance_type=None,
):
    coverage_name = detect_requested_coverage(
        question_text
    )

    candidates = []

    for rule in POLICY_RULES:
        if (
            insurance_type
            and rule.get("보험 종류")
            and rule.get("보험 종류") != insurance_type
        ):
            continue

        rule_coverage = str(
            rule.get(
                "담보명",
                "",
            )
        )

        if (
            coverage_name
            and rule_coverage != coverage_name
        ):
            continue

        searchable = " ".join(
            str(value)
            for value in rule.values()
            if value is not None
        )

        score = 0

        for term in get_question_search_terms(
            question_text,
            coverage_name,
        ):
            if (
                normalize_policy_search_text(term)
                in normalize_policy_search_text(searchable)
            ):
                score += 1

        if coverage_name:
            score += 20

        if score > 0:
            candidates.append(
                (
                    score,
                    rule,
                )
            )

    if not candidates:
        return None

    candidates.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    rule = candidates[0][1]

    original_text = ""

    for key in [
        "약관 원문",
        "조문 원문",
        "조항 원문",
        "원문",
        "본문",
    ]:
        value = str(
            rule.get(
                key,
                "",
            )
            or ""
        ).strip()

        if value:
            original_text = value
            break

    if not original_text:
        return {
            "관련 담보": rule.get(
                "담보명",
                coverage_name or "확인 필요",
            ),
            "원문": "",
            "PDF": rule.get(
                "PDF 파일명",
                "",
            ),
            "페이지": rule.get(
                "PDF 페이지",
                "",
            ),
            "오류": (
                "약관 규칙 자료에는 요약값만 있고 "
                "PDF 원문이 저장되어 있지 않습니다."
            ),
        }

    return {
        "관련 담보": rule.get(
            "담보명",
            coverage_name or "확인 필요",
        ),
        "원문": original_text,
        "PDF": rule.get(
            "PDF 파일명",
            "",
        ),
        "페이지": rule.get(
            "PDF 페이지",
            "",
        ),
        "오류": "",
    }


def build_consultation_answer(
    selected_coverages,
    question_text,
    insurance_type=None,
):
    pdf_result = find_policy_original_in_pdfs(
        question_text,
        insurance_type,
    )

    if pdf_result.get(
        "원문"
    ):
        return pdf_result

    rule_result = find_policy_original_in_rules(
        question_text,
        insurance_type,
    )

    if (
        rule_result
        and rule_result.get(
            "원문"
        )
    ):
        return rule_result

    if rule_result:
        return rule_result

    return pdf_result


# 보호 구역: 실제 음성변환 회귀시험 없이 이 코드를 수정하지 말 것
# 이 섹션은 마이크 입력, OpenAI 변환, 세션 캐시와 rerun 보호 로직만 담당한다.
def initialize_state():
    defaults = {
        "accident_input_text": "",
        "processed_audio_hash": "",
        "failed_audio_hash": "",
        "stt_error": "",
        "force_stt_retry": False,
        "transcription_cache": {},
        "analysis_result": None,
        "policy_question_text": "",
        "question_processed_audio_hash": "",
        "question_failed_audio_hash": "",
        "question_stt_error": "",
        "question_force_stt_retry": False,
        "policy_question_answer": None,
    }

    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def process_recorded_audio(recorded_audio):
    try:
        audio_bytes = recorded_audio.getvalue()
    except Exception as exc:
        st.session_state.stt_error = (
            "녹음된 오디오를 읽지 못했습니다. 마이크 권한과 브라우저 녹음 상태를 다시 확인해 주세요."
        )
        st.session_state.failed_audio_hash = ""
        return

    if not audio_bytes:
        st.session_state.stt_error = (
            "녹음된 파일이 비어 있습니다. 마이크에 가까이 대고 5초 이상 말한 뒤 다시 녹음해 주세요."
        )
        st.session_state.failed_audio_hash = ""
        return

    audio_hash = hashlib.sha256(
        audio_bytes
    ).hexdigest()

    cached_text = st.session_state.get("transcription_cache", {}).get(audio_hash)
    if cached_text:
        st.session_state.accident_input_text = cached_text
        st.session_state.processed_audio_hash = audio_hash
        st.session_state.failed_audio_hash = ""
        st.session_state.stt_error = ""
        return

    should_retry = bool(
        st.session_state.get(
            "force_stt_retry"
        )
    )

    already_succeeded = (
        audio_hash
        == st.session_state.get(
            "processed_audio_hash"
        )
    )

    already_failed = (
        audio_hash
        == st.session_state.get(
            "failed_audio_hash"
        )
    )

    if already_succeeded:
        return

    if (
        already_failed
        and not should_retry
    ):
        return

    st.session_state.force_stt_retry = False

    file_name, mime_type = safe_audio_metadata(
        recorded_audio
    )

    try:
        with st.spinner(
            "음성을 문자로 바꾸는 중입니다"
        ):
            transcript = transcribe_audio(
                audio_bytes,
                file_name,
                mime_type,
            )

        st.session_state.accident_input_text = (
            transcript
        )
        st.session_state.transcription_cache[audio_hash] = transcript
        st.session_state.processed_audio_hash = (
            audio_hash
        )
        st.session_state.failed_audio_hash = ""
        st.session_state.stt_error = ""

    except Exception as error:
        st.session_state.failed_audio_hash = (
            audio_hash
        )
        st.session_state.stt_error = str(
            error
        )



def process_question_recorded_audio(recorded_audio):
    try:
        audio_bytes = recorded_audio.getvalue()
    except Exception:
        st.session_state.question_stt_error = (
            "질문 녹음파일을 읽지 못했습니다. "
            "Chrome의 마이크 권한을 확인해 주세요."
        )
        return

    if not audio_bytes:
        st.session_state.question_stt_error = (
            "질문 녹음 내용이 비어 있습니다. "
            "2초 이상 말한 뒤 녹음을 종료해 주세요."
        )
        return

    audio_hash = hashlib.sha256(audio_bytes).hexdigest()

    cached_text = st.session_state.get(
        "transcription_cache",
        {},
    ).get(audio_hash)

    if cached_text:
        st.session_state.policy_question_text = cached_text
        st.session_state.question_processed_audio_hash = audio_hash
        st.session_state.question_failed_audio_hash = ""
        st.session_state.question_stt_error = ""
        return

    already_succeeded = (
        audio_hash
        == st.session_state.get(
            "question_processed_audio_hash"
        )
    )

    already_failed = (
        audio_hash
        == st.session_state.get(
            "question_failed_audio_hash"
        )
    )

    should_retry = bool(
        st.session_state.get(
            "question_force_stt_retry"
        )
    )

    if already_succeeded:
        return

    if already_failed and not should_retry:
        return

    st.session_state.question_force_stt_retry = False

    file_name, mime_type = safe_audio_metadata(
        recorded_audio
    )

    try:
        with st.spinner(
            "약관 질문을 문자로 바꾸는 중입니다"
        ):
            transcript = transcribe_audio(
                audio_bytes,
                file_name,
                mime_type,
            )

        st.session_state.policy_question_text = transcript
        st.session_state.transcription_cache[audio_hash] = transcript
        st.session_state.question_processed_audio_hash = audio_hash
        st.session_state.question_failed_audio_hash = ""
        st.session_state.question_stt_error = ""
        st.session_state.policy_question_answer = None

    except Exception as error:
        st.session_state.question_failed_audio_hash = audio_hash
        st.session_state.question_stt_error = str(error)


def reflow_policy_text_for_reading(original_text):
    if not original_text:
        return ""

    text_value = str(
        original_text
    ).replace(
        "\u200b",
        "",
    ).replace(
        "\ufeff",
        "",
    )

    lines = text_value.splitlines()
    paragraphs = []
    sentence_buffer = []

    def flush_sentence_buffer():
        nonlocal sentence_buffer

        if sentence_buffer:
            paragraph = " ".join(
                sentence_buffer
            )

            paragraph = re.sub(
                r"[ \t]+",
                " ",
                paragraph,
            ).strip()

            if paragraph:
                paragraphs.append(
                    paragraph
                )

        sentence_buffer = []

    for raw_line in lines:
        line = re.sub(
            r"[ \t]+",
            " ",
            raw_line,
        ).strip()

        if not line:
            flush_sentence_buffer()
            continue

        if set(line) <= {"━", "-", "─", "—"}:
            flush_sentence_buffer()
            continue

        if re.fullmatch(
            r"\[PDF\s*\d+쪽\]",
            line,
        ):
            flush_sentence_buffer()
            paragraphs.append(
                line
            )
            continue

        is_clause_heading = bool(
            re.match(
                r"^(제\s*\d+\s*[조장절편]|"
                r"[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|"
                r"\d+\.\s*|"
                r"[가-힣]\.\s*)",
                line,
            )
        )

        is_short_heading = (
            len(line) <= 32
            and not re.search(
                r"[.!?。]$",
                line,
            )
            and any(
                word in line
                for word in [
                    "보상하는 손해",
                    "보상하지 않는 손해",
                    "피보험자",
                    "보험금",
                    "지급기준",
                    "용어의 정의",
                    "청구",
                    "면책",
                    "담보",
                    "특약",
                ]
            )
        )

        if (
            is_clause_heading
            or is_short_heading
        ):
            flush_sentence_buffer()
            sentence_buffer.append(
                line
            )

            if is_short_heading:
                flush_sentence_buffer()

            continue

        sentence_buffer.append(
            line
        )

        if re.search(
            r"(다\.|니다\.|습니다\.|[.!?。])$",
            line,
        ):
            flush_sentence_buffer()

    flush_sentence_buffer()

    return "\n\n".join(
        paragraphs
    )


def render_policy_question_section(result):
    st.subheader("약관 내용 확인")

    st.caption(
        "원하는 담보의 약관 규정을 말하거나 직접 입력해 주세요. "
        "등록된 자동차보험 약관 PDF에서 일치하는 원문을 찾아 "
        "요약하지 않고 그대로 표시합니다."
    )

    question_audio = st.audio_input(
        "약관 질문 녹음 시작",
        key="policy_question_audio",
        label_visibility="visible",
    )

    if question_audio is not None:
        process_question_recorded_audio(
            question_audio
        )

    if st.session_state.get(
        "question_stt_error"
    ):
        st.error(
            "질문을 문자로 바꾸지 못했습니다. "
            f"{st.session_state.question_stt_error}"
        )

        if st.button(
            "같은 질문 녹음 다시 변환",
            key="retry_policy_question_stt",
        ):
            st.session_state.question_force_stt_retry = True
            st.session_state.question_failed_audio_hash = ""
            st.session_state.question_stt_error = ""
            st.rerun()

    elif st.session_state.get(
        "question_processed_audio_hash"
    ):
        st.success(
            "질문이 문자로 변환되었습니다. "
            "아래 문장을 확인하거나 수정해 주세요."
        )

    question_text = st.text_area(
        "질문 내용 확인 및 수정",
        key="policy_question_text",
        height=130,
        placeholder=(
            "예: 무보험자동차에 의한 상해 담보의 "
            "약관 규정을 보여주세요."
        ),
    )

    if st.button(
        "약관 내용 찾기",
        key="find_policy_answer",
    ):
        if not question_text.strip():
            st.warning(
                "찾으려는 담보나 약관 내용을 "
                "말하거나 직접 입력해 주세요."
            )
        else:
            st.session_state.policy_question_answer = (
                build_consultation_answer(
                    result.get(
                        "selected_coverages",
                        [],
                    ),
                    question_text,
                    result.get(
                        "insurance_type",
                    ),
                )
            )

    answer = st.session_state.get(
        "policy_question_answer"
    )

    if not answer:
        return

    error_message = str(
        answer.get(
            "오류",
            "",
        )
        or ""
    ).strip()

    original_text = str(
        answer.get(
            "원문",
            "",
        )
        or ""
    ).strip()

    if error_message and not original_text:
        st.warning(
            error_message
        )
        return

    st.markdown("#### 관련 약관 규정")

    st.markdown(
        "##### PDF 약관 원문"
    )

    reading_text = reflow_policy_text_for_reading(
        original_text
    )

    st.markdown(
        "<div style=\""
        "display:block;"
        "width:100%;"
        "max-width:100%;"
        "writing-mode:horizontal-tb !important;"
        "text-orientation:mixed !important;"
        "white-space:pre-wrap;"
        "word-break:normal;"
        "overflow-wrap:break-word;"
        "max-height:620px;"
        "overflow-y:auto;"
        "overflow-x:hidden;"
        "padding:24px;"
        "box-sizing:border-box;"
        "background:#ffffff;"
        "color:#111111;"
        "border:1px solid #d0d7de;"
        "border-radius:10px;"
        "line-height:1.85;"
        "font-size:16px;"
        "font-family:-apple-system,BlinkMacSystemFont,"
        "'Apple SD Gothic Neo','Noto Sans KR',sans-serif;"
        "text-align:left;"
        "\">"
        + escape(reading_text)
        + "</div>",
        unsafe_allow_html=True,
    )

    page_value = answer.get(
        "페이지",
        "",
    )

    if page_value:
        st.markdown(
            f"**관련 페이지: {page_value}쪽**"
        )
    else:
        st.markdown(
            "**관련 페이지: 확인 필요**"
        )

    pdf_name = str(
        answer.get(
            "PDF",
            "",
        )
        or ""
    ).strip()

    if pdf_name:
        st.caption(
            f"출처: {pdf_name}"
        )

def format_currency_value(raw_value):
    if raw_value is None:
        return "미입력"

    value = str(raw_value).strip()
    if value == "":
        return "미입력"

    if value.lower() in {
        "미입력",
        "선택하세요",
    }:
        return "미입력"

    digits = re.sub(r"[^0-9-]", "", value)
    if digits in {"", "-"}:
        return "미입력"

    try:
        number = int(digits)
    except ValueError:
        return "미입력"

    return f"{number:,.0f}원"


def extract_numeric_digits(raw_value):
    if raw_value is None:
        return ""

    text = str(raw_value).strip()
    if text == "":
        return ""

    if text.lower() in {"미입력", "none", "null", "선택하세요"}:
        return ""

    digits = re.sub(r"[^0-9]", "", text)
    return digits


def format_currency_text(raw_value):
    digits = extract_numeric_digits(raw_value)
    if digits == "":
        return ""
    return f"{int(digits):,}"


def convert_currency_to_int(raw_value):
    digits = extract_numeric_digits(raw_value)
    if digits == "":
        return None
    return int(digits)


def apply_currency_mask(raw_value):
    digits = extract_numeric_digits(raw_value)
    if digits == "":
        return ""
    return f"{int(digits):,}"


def format_currency_widget_value(key):
    st.session_state[key] = apply_currency_mask(
        st.session_state.get(key, "")
    )


def render_money_input(label, key, help_text=None):
    if key not in st.session_state:
        st.session_state[key] = ""
    else:
        st.session_state[key] = apply_currency_mask(
            st.session_state.get(key, "")
        )

    input_value = st.text_input(
        label,
        key=key,
        help=help_text,
        placeholder="0",
        max_chars=18,
        on_change=format_currency_widget_value,
        args=(key,),
    )

    digits = extract_numeric_digits(input_value)
    if input_value and not digits:
        st.caption("숫자만 입력할 수 있습니다. 천 단위 쉼표는 자동으로 표시됩니다.")

    return convert_currency_to_int(input_value)


def render_white_table(headers, rows):
    header_html = "".join(
        f"<th>{escape(str(header))}</th>"
        for header in headers
    )
    body_html = []
    for row in rows:
        cells = "".join(
            f"<td>{escape(str(row.get(header, '')))}</td>"
            for header in headers
        )
        body_html.append(f"<tr>{cells}</tr>")

    st.markdown(
        "<div style='overflow-x:auto'>"
        "<table class='white-excel-table'>"
        f"<thead><tr>{header_html}</tr></thead>"
        f"<tbody>{''.join(body_html)}</tbody>"
        "</table></div>",
        unsafe_allow_html=True,
    )


def build_analysis_summary(
    position,
    accident_text,
    insurance_type,
    insurer,
    insurance_period,
    injury_grade,
    disability_grade,
    hospital_days,
    fault_rate,
    selected_coverages,
    preconditions=None,
):
    missing = []

    if not accident_text.strip():
        missing.append("사고내용")

    if not insurer.strip():
        missing.append("보험회사")

    if not insurance_period.strip():
        missing.append("보험기간")

    if not selected_coverages:
        missing.append("가입담보")

    return {
        "position": position,
        "accident_text": accident_text.strip(),
        "insurance_type": insurance_type,
        "insurer": insurer.strip(),
        "insurance_period": insurance_period.strip(),
        "injury_grade": injury_grade,
        "disability_grade": disability_grade,
        "hospital_days": int(hospital_days) if isinstance(hospital_days, (int, float)) and hospital_days >= 0 else 0,
        "fault_rate": fault_rate,
        "selected_coverages": selected_coverages,
        "preconditions": preconditions or {},
        "missing": missing,
    }


def load_policy_rules():
    rule_path = PROJECT_ROOT / "data" / "processed" / "policy_rules.json"
    if not rule_path.exists():
        return []

    try:
        with rule_path.open("r", encoding="utf-8") as source:
            data = json.load(source)
        if isinstance(data, list):
            return data
    except Exception:
        return []

    return []


POLICY_RULES = load_policy_rules()


def get_policy_rule(insurance_type, coverage_name):
    for item in POLICY_RULES:
        if (
            item.get("보험 종류") == insurance_type
            and item.get("담보명") == coverage_name
        ):
            return item
    return None


def get_additional_info_fields(coverage_name):
    field_map = {
        "대인배상Ⅰ": [
            "실제 치료비 또는 손해액",
            "상대방 보험 가입 여부",
        ],
        "대인배상Ⅱ": [
            "실제 치료비 또는 손해액",
            "상대방 보험 가입 여부",
        ],
        "대물배상": [
            "실제 손해액 또는 비용",
            "상대방 보험 가입 여부",
        ],
        "자기신체사고": [
            "실제 치료비 또는 손해액",
            "부상·후유장해 관련 확인자료",
        ],
        "무보험자동차에의한상해": [
            "실제 치료비 또는 손해액",
            "상대방 보험 가입 여부",
        ],
        "자기차량손해": [
            "실제 수리비 또는 손해액",
            "차량가액 또는 손해액",
        ],
    }

    return field_map.get(coverage_name, [])


def parse_optional_amount(value):
    if value is None:
        return None

    text = str(value).strip()
    if text == "":
        return None

    if text.lower() in {"미입력", "none", "null"}:
        return None

    digits = re.sub(r"[^0-9-]", "", text)
    if digits in {"", "-"}:
        return None

    try:
        return int(digits)
    except ValueError:
        return None


def get_coverage_cost_fields(coverage_name):
    field_map = {
        "대인배상Ⅰ": [
            "치료비",
            "수술비",
            "입원비",
            "통원치료비",
            "휴업손해",
        ],
        "대물배상": [
            "차량수리비",
            "견인비",
            "대차료 또는 교통비",
            "기타 재산손해",
        ],
        "자기신체사고": [
            "치료비",
            "수술비",
            "입원비",
            "통원치료비",
            "휴업손해",
        ],
        "무보험자동차에의한상해": [
            "치료비",
            "수술비",
            "입원비",
            "통원치료비",
            "휴업손해",
        ],
        "자기차량손해": [
            "차량수리비",
            "견인비",
            "대차료 또는 교통비",
            "기타 재산손해",
        ],
    }
    return field_map.get(coverage_name, [])


def make_widget_key(*parts):
    normalized = []
    for part in parts:
        text = str(part)
        cleaned = re.sub(
            r"[^0-9A-Za-z]+",
            "_",
            text,
        ).strip("_")
        if cleaned:
            normalized.append(cleaned.lower())
        else:
            normalized.append("item")
    return "_".join(normalized)


def make_unique_key(screen_area, coverage_code=None, item_code=None, repeat_index=0, question_index=0):
    parts = [str(screen_area).strip() or "screen"]
    if coverage_code:
        parts.append(str(coverage_code).strip())
    if item_code:
        parts.append(str(item_code).strip())
    parts.append(f"r{int(repeat_index or 0)}")
    parts.append(f"q{int(question_index or 0)}")
    return "_".join(parts)


def get_coverage_code(coverage_name):
    return COVERAGE_CODES.get(coverage_name, make_widget_key(coverage_name))


def get_field_code(field_name):
    return COST_FIELD_CODES.get(field_name, make_widget_key(field_name))


def get_coverage_input_key(coverage_name, field_name, index):
    return make_unique_key(
        "actual_cost",
        get_coverage_code(coverage_name),
        get_field_code(field_name),
        repeat_index=index,
        question_index=0,
    )


def get_coverage_selection_key(coverage_name, index):
    return make_unique_key(
        "coverage_select",
        get_coverage_code(coverage_name),
        "selected",
        repeat_index=index,
        question_index=0,
    )


def get_coverage_amount_key(coverage_name, index):
    return make_unique_key(
        "coverage_input",
        get_coverage_code(coverage_name),
        "amount",
        repeat_index=index,
        question_index=0,
    )


def get_coverage_deductible_key(coverage_name, index):
    return make_unique_key(
        "coverage_input",
        get_coverage_code(coverage_name),
        "deductible",
        repeat_index=index,
        question_index=0,
    )


def read_cost_value(coverage_name, field_name, index=0):
    session_inputs = st.session_state.setdefault("actual_cost_inputs", {})
    return session_inputs.get(
        get_coverage_input_key(coverage_name, field_name, index),
        None,
    )


def sum_relevant_costs_for_coverage(coverage_name):
    fields = get_coverage_cost_fields(coverage_name)
    if not fields:
        return None

    total = 0
    field_values = {}
    for idx, field_name in enumerate(fields):
        value = parse_optional_amount(
            read_cost_value(coverage_name, field_name, idx)
        )
        if value is not None:
            field_values[field_name] = value

    if coverage_name in {
        "대인배상Ⅰ",
        "자기신체사고",
        "무보험자동차에의한상해",
    }:
        treatment_total = field_values.get("치료비")
        surgery = field_values.get("수술비")
        inpatient = field_values.get("입원비")
        outpatient = field_values.get("통원치료비")
        income_loss = field_values.get("휴업손해")

        if treatment_total is not None:
            total += treatment_total
        else:
            total += surgery or 0
            total += inpatient or 0
            total += outpatient or 0

        if income_loss is not None:
            total += income_loss

    elif coverage_name in {"대물배상", "자기차량손해"}:
        for field_name in [
            "차량수리비",
            "견인비",
            "대차료 또는 교통비",
            "기타 재산손해",
        ]:
            total += field_values.get(field_name, 0)

    return total if total > 0 else None


def render_actual_cost_inputs(selected_coverages):
    if not selected_coverages:
        return

    st.subheader("실제 손해·비용 입력")
    st.caption(
        "선택한 담보에 필요한 비용만 표시합니다. "
        "치료비 항목에 포함된 수술비·입원비·통원치료비는 다시 더하지 않습니다."
    )

    for item in selected_coverages:
        coverage_name = item.get("담보명")
        fields = get_coverage_cost_fields(coverage_name)
        if not fields:
            continue

        with st.expander(f"{coverage_name} 실제 손해·비용", expanded=False):
            for index, field_name in enumerate(fields):
                key = get_coverage_input_key(
                    coverage_name,
                    field_name,
                    index,
                )

                value = render_money_input(
                    field_name,
                    key,
                    help_text="숫자만 입력하세요. 쉼표는 자동으로 표시됩니다.",
                )

                st.session_state.setdefault("actual_cost_inputs", {})[key] = value


def get_total_dedupe_group(coverage_name):
    if coverage_name in {"대인배상Ⅰ", "자기신체사고", "무보험자동차에의한상해"}:
        return "상해치료비"
    return coverage_name


def parse_fault_percentage(fault_rate):
    fault_text = str(fault_rate or "")
    if (
        "아직 확인되지 않음" in fault_text
        or "사용자가 확인하려는 임의 비율" in fault_text
    ):
        return None

    match = re.search(r"(?<!\d)(\d{1,3})%", fault_text)
    if not match:
        return None
    percentage = int(match.group(1))
    return percentage if 0 <= percentage <= 100 else None


def render_input_review_tables(result):
    st.subheader("입력정보")
    preconditions = result.get("preconditions") or {}
    review_rows = [
        {"항목": "사용자 입장", "입력값": result.get("position") or "미입력"},
        {"항목": "보험 종류", "입력값": result.get("insurance_type") or "미입력"},
        {"항목": "보험회사", "입력값": result.get("insurer") or "미입력"},
        {"항목": "보험기간", "입력값": result.get("insurance_period") or "미입력"},
        {"항목": "부상급수", "입력값": result.get("injury_grade") or "미입력"},
        {"항목": "후유장애급수", "입력값": result.get("disability_grade") or "미입력"},
        {"항목": "입원일수", "입력값": result.get("hospital_days", 0) if result.get("hospital_days") is not None else "미입력"},
        {"항목": "적용 과실비율", "입력값": result.get("fault_rate") or "미입력"},
        {"항목": "사고내용", "입력값": result.get("accident_text") or "미입력"},
    ]
    for key, value in sorted(preconditions.items()):
        review_rows.append({"항목": key, "입력값": value or "확인 필요"})
    render_white_table(["항목", "입력값"], review_rows)

    st.markdown("#### 선택한 가입담보")
    coverage_rows = []
    for item in result.get("selected_coverages", []):
        coverage_rows.append(
            {
                "가입담보명": item.get("담보명", "확인 필요"),
                "가입한도": item.get("가입금액·보상한도", "미입력"),
                "자기부담금": item.get("자기부담금", "미입력"),
            }
        )

    if coverage_rows:
        render_white_table(
            ["가입담보명", "가입한도", "자기부담금"],
            coverage_rows,
        )
    else:
        st.info("선택한 가입담보가 없습니다.")


def get_required_policy_inputs(coverage_name):
    base = ["실제 손해비용", "가입한도", "자기부담금", "과실률"]
    if coverage_name in {"대인배상Ⅰ", "대인배상Ⅱ", "자기신체사고", "무보험자동차에의한상해"}:
        base.append("부상급수")
    if coverage_name == "자기신체사고":
        base.append("입원일수")
    return base


def build_policy_analysis_rows(result):
    selected_coverages = result.get("selected_coverages", [])
    if not selected_coverages:
        return [], []

    insurance_type = result.get("insurance_type")
    fault_percentage = parse_fault_percentage(result.get("fault_rate"))
    rows = []
    excluded_rows = []
    total_estimate = 0
    counted_groups = set()
    disability_grade = result.get("disability_grade") or "아직 확인되지 않음"
    injury_grade = result.get("injury_grade") or "아직 확인되지 않음"
    hospital_days = result.get("hospital_days", 0)
    preconditions = result.get("preconditions") or {}

    def summarize_preconditions():
        summary = []
        for key, value in preconditions.items():
            if not value or value in {"확인되지 않음", "해당 없음", "아직 정해지지 않음"}:
                continue
            summary.append(f"{key}: {value}")
        return " | ".join(summary)

    for item in selected_coverages:
        coverage_name = item.get("담보명")
        rule = get_policy_rule(insurance_type, coverage_name)
        limit_value = parse_optional_amount(item.get("가입금액·보상한도"))
        deductible_value = parse_optional_amount(item.get("자기부담금"))
        uses_actual_cost = coverage_name != "대인배상Ⅱ"
        actual_total = sum_relevant_costs_for_coverage(coverage_name) if uses_actual_cost else None

        formula = str(rule.get("계산식", "")) if rule else ""
        missing_values = []
        if uses_actual_cost and actual_total is None:
            missing_values.append("실제 손해비용")
        if deductible_value is None:
            missing_values.append("자기부담금")
        if fault_percentage is None:
            missing_values.append("적용 과실비율")
        if limit_value is None:
            missing_values.append("가입한도")

        if coverage_name in {"대인배상Ⅰ", "대인배상Ⅱ", "자기신체사고", "무보험자동차에의한상해"} and injury_grade in {"아직 확인되지 않음", "해당 없음"}:
            missing_values.append("부상급수")
        if coverage_name == "자기신체사고" and hospital_days is None:
            missing_values.append("입원일수")

        estimated = None
        review_amount = None
        basis = "산정 보류"

        if coverage_name == "대물배상":
            basis = "대물배상은 부상급수·후유장애급수·입원일수 적용 대상이 아니며, 실제 손해액과 약관 한도 확인 필요"
        elif not rule or not formula or "확인 필요" in formula:
            basis = "약관 원문 확인 필요"
        elif missing_values:
            basis = f"산정 보류: {', '.join(missing_values)} 확인 필요"
        elif coverage_name == "자기차량손해":
            fault_adjusted = actual_total * (100 - fault_percentage) // 100
            review_amount = min(max(fault_adjusted - deductible_value, 0), limit_value)
            estimated = review_amount
            basis = "실제 손해액 × (100%-적용 과실비율) - 자기부담금, 가입한도 이내 적용; 최종 약관·사고조사 확인 필요"
        elif coverage_name == "대인배상Ⅰ":
            basis = f"대인배상Ⅰ 지급기준 · 부상급수 {injury_grade} 적용 · 실제 손해액과 보험 한도 검토 · 적용 과실비율 {fault_percentage}% 입력 · 약관 원문 확인 필요"
            if actual_total and actual_total > 0:
                review_amount = min(actual_total, limit_value)
                estimated = review_amount
        elif coverage_name == "대인배상Ⅱ":
            basis = "대인배상Ⅱ는 부상급수만으로 산정하지 않고, 실제 손해액·대인배상Ⅰ 지급액·적용 과실비율·약관 공제 규정을 함께 검토해야 함"
        elif coverage_name == "자기신체사고":
            if actual_total and actual_total > 0:
                review_amount = min(max(actual_total - deductible_value, 0), limit_value)
                estimated = review_amount
                basis = f"자기신체사고는 실제 손해액에서 자기부담금을 차감한 범위와 가입한도를 함께 검토하며, 부상급수 {injury_grade}와 입원일수 {hospital_days}일을 함께 반영해야 함"
        elif coverage_name == "무보험자동차에의한상해":
            if actual_total and actual_total > 0:
                review_amount = min(max(actual_total - deductible_value, 0), limit_value)
                estimated = review_amount
                basis = f"무보험자동차에의한상해는 실제 손해액·부상급수 {injury_grade}·적용 과실비율 {fault_percentage}%를 함께 검토해야 하며, 약관상 한도와 공제액을 반영해야 함"
        else:
            basis = "약관의 지급기준·공제액 등 추가 적용값 검토 필요"

        precondition_note = summarize_preconditions()
        if precondition_note:
            basis = f"{basis} | 전제조건: {precondition_note}"

        if estimated is not None:
            group_key = get_total_dedupe_group(coverage_name)
            if group_key not in counted_groups:
                total_estimate += estimated
                counted_groups.add(group_key)

        row_values = {
            "가입담보명": coverage_name,
            "가입한도": item.get("가입금액·보상한도", "미입력"),
            "실제 손해비용": format_currency_value(actual_total) if actual_total is not None else ("해당 없음" if coverage_name == "대물배상" or coverage_name == "대인배상Ⅱ" else "미입력"),
            "자기부담금": item.get("자기부담금", "미입력"),
            "후유장애급수": "해당 없음" if coverage_name == "대물배상" else (disability_grade if coverage_name in {"대인배상Ⅰ", "대인배상Ⅱ", "자기신체사고", "무보험자동차에의한상해"} else "해당 없음"),
            "부상급수": "해당 없음" if coverage_name == "대물배상" else (injury_grade if coverage_name in {"대인배상Ⅰ", "대인배상Ⅱ", "자기신체사고", "무보험자동차에의한상해"} else "해당 없음"),
            "입원일수": "해당 없음" if coverage_name == "대물배상" else (str(hospital_days) + "일" if hospital_days is not None else "0일"),
            "적용 과실비율": result.get("fault_rate", "확인 필요"),
            "약관상 예상 지급액": format_currency_value(estimated) if estimated is not None else ("약관 확인 필요" if basis == "약관 확인 필요" else "산정 보류"),
            "청구 검토금액": format_currency_value(review_amount) if review_amount is not None else "산정 보류",
            "적용 약관 규정 및 산정근거": basis,
            "계산가능금액": estimated,
            "검토가능금액": review_amount,
            "근거 PDF": rule.get("PDF 파일명", "확인 필요") if rule else "확인 필요",
            "PDF 페이지": rule.get("PDF 페이지", "확인 필요") if rule else "확인 필요",
            "조문명": rule.get("조문명", "확인 필요") if rule else "확인 필요",
        }
        rows.append(row_values)

        if estimated is None:
            excluded_rows.append({"담보명": coverage_name, "사유": basis})

    st.session_state["policy_analysis_payload"] = {
        "result": result,
        "rows": rows,
        "excluded_rows": excluded_rows,
        "total_estimate": total_estimate,
    }
    return rows, excluded_rows


def build_analysis_table(rows):
    visible_headers = [
        "가입담보명",
        "가입한도",
        "실제 손해비용",
        "자기부담금",
        "후유장애급수",
        "부상급수",
        "입원일수",
        "적용 과실비율",
        "약관상 예상 지급액",
        "청구 검토금액",
        "적용 약관 규정 및 산정근거",
    ]
    table_rows = [{header: row.get(header, "") for header in visible_headers} for row in rows]

    calculated_values = [row.get("계산가능금액") for row in rows if row.get("계산가능금액") is not None]
    calculated_reviews = [row.get("검토가능금액") for row in rows if row.get("검토가능금액") is not None]
    total_estimate = sum(calculated_values)
    total_review = sum(calculated_reviews)

    total_row = {
        "가입담보명": "합계",
        "가입한도": "",
        "실제 손해비용": "",
        "자기부담금": "",
        "후유장애급수": "",
        "부상급수": "",
        "입원일수": "",
        "적용 과실비율": "",
        "약관상 예상 지급액": "산정 보류" if not calculated_values else format_currency_value(total_estimate),
        "청구 검토금액": "산정 보류" if not calculated_reviews else format_currency_value(total_review),
        "적용 약관 규정 및 산정근거": "산정 보류 항목은 합계에서 제외함",
    }
    table_rows.append(total_row)
    return table_rows, total_estimate


def build_analysis_excel(result, rows, excluded_rows, total_estimate):
    try:
        from io import BytesIO
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Side, Border
    except ImportError as exc:
        raise RuntimeError("openpyxl이 설치되어 있지 않습니다.") from exc

    workbook = Workbook()

    input_sheet = workbook.active
    input_sheet.title = "입력정보"
    input_sheet.append(["항목", "값"])
    input_sheet.append(["사용자 입장", result.get("position", "미입력")])
    input_sheet.append(["보험 종류", result.get("insurance_type", "미입력")])
    input_sheet.append(["보험회사", result.get("insurer", "미입력")])
    input_sheet.append(["보험기간", result.get("insurance_period", "미입력")])
    input_sheet.append(["부상급수", result.get("injury_grade", "미입력")])
    input_sheet.append(["후유장애급수", result.get("disability_grade", "미입력")])
    input_sheet.append(["입원일수", result.get("hospital_days", 0)])
    input_sheet.append(["적용 과실비율", result.get("fault_rate", "미입력")])
    input_sheet.append(["사고내용", result.get("accident_text", "미입력")])
    for cell in input_sheet["A1:B1"][0]:
        cell.font = Font(bold=True)

    policy_rows, _ = build_analysis_table(rows)
    policy_sheet = workbook.create_sheet("보상분석표")
    policy_headers = [
        "가입담보명",
        "가입한도",
        "실제 손해비용",
        "자기부담금",
        "후유장애급수",
        "부상급수",
        "입원일수",
        "적용 과실비율",
        "약관상 예상 지급액",
        "청구 검토금액",
        "적용 약관 규정 및 산정근거",
    ]
    policy_sheet.append(policy_headers)
    title_fill = PatternFill("solid", fgColor="D9E2F3")
    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for row in policy_rows:
        policy_sheet.append([row.get(header, "") for header in policy_headers])
    for cell in policy_sheet[1]:
        cell.font = Font(bold=True, color="000000")
        cell.fill = title_fill
        cell.border = border
    for row_cells in policy_sheet.iter_rows(min_row=2, max_row=policy_sheet.max_row, min_col=1, max_col=len(policy_headers)):
        for cell in row_cells:
            cell.border = border
    if policy_sheet.max_row > 1:
        last_row = policy_sheet[policy_sheet.max_row]
        for cell in last_row:
            cell.font = Font(bold=True)
    policy_sheet.freeze_panes = "A2"
    policy_sheet.print_title_rows = "1:1"
    policy_sheet.page_setup.orientation = "landscape"
    policy_sheet.page_setup.fitToWidth = 1
    policy_sheet.page_setup.fitToHeight = 0
    policy_sheet.sheet_view.showGridLines = True
    policy_sheet.calculate_dimension()

    consultation_sheet = workbook.create_sheet("상담내용")
    consultation_sheet.append(["번호", "질문", "관련 담보", "약관 답변", "조문", "PDF", "페이지"])

    evidence_sheet = workbook.create_sheet("약관근거")
    evidence_sheet.append(["담보명", "근거 PDF", "PDF 페이지", "조문명"])
    for row in rows:
        evidence_sheet.append([
            row.get("가입담보명", ""),
            row.get("근거 PDF", "확인 필요"),
            row.get("PDF 페이지", "확인 필요"),
            row.get("조문명", "확인 필요"),
        ])

    excluded_sheet = workbook.create_sheet("계산제외항목")
    excluded_sheet.append(["담보명", "사유", "근거 PDF", "PDF 페이지", "조문명"])
    for row in excluded_rows:
        excluded_sheet.append([
            row.get("담보명", ""),
            row.get("사유", ""),
            row.get("근거 PDF", ""),
            row.get("PDF 페이지", ""),
            row.get("조문명", ""),
        ])

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def render_policy_analysis_result(result):
    selected_coverages = result.get("selected_coverages", [])
    if not selected_coverages:
        st.info("선택한 담보가 없어 약관 기준 분석을 시작할 수 없습니다.")
        return

    rows, excluded_rows = build_policy_analysis_rows(result)
    analysis_table, total_estimate = build_analysis_table(rows)

    st.subheader("약관 기준 보상 분석")
    st.caption(
        "표시된 금액은 입력정보와 확인된 약관에 따른 이론상 예상 범위입니다. "
        "실제 지급 여부와 금액은 보험증권, 사고조사, 제출서류, 확정 과실률 및 보험회사의 심사에 따라 달라질 수 있습니다. "
        "이 앱은 합의금을 산정하지 않습니다."
    )

    if analysis_table:
        render_white_table(
            [
                "가입담보명",
                "가입한도",
                "실제 손해비용",
                "자기부담금",
                "후유장애급수",
                "부상급수",
                "입원일수",
                "적용 과실비율",
                "약관상 예상 지급액",
                "청구 검토금액",
                "적용 약관 규정 및 산정근거",
            ],
            analysis_table,
        )

    payload = st.session_state.get("policy_analysis_payload")
    if payload:
        try:
            excel_data = build_analysis_excel(
                payload["result"],
                payload["rows"],
                payload["excluded_rows"],
                payload["total_estimate"],
            )
            st.download_button(
                label="엑셀 보상분석표 다운로드",
                data=excel_data,
                file_name="보상분석표.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                key="download_policy_analysis_excel_v1",
            )
        except RuntimeError as exc:
            st.warning(str(exc))


initialize_state()

# =========================================================
# 홈페이지 시작 화면
# =========================================================

if not st.session_state.get("homepage_started", False):
    st.html(
        """
        <style>
        .kh-home {
            --kh-ink: #172033;
            --kh-sub: #596579;
            --kh-blue: #2563eb;
            --kh-blue-dark: #1746b0;
            --kh-line: #dfe6ef;
            --kh-soft: #f5f8fc;
        }

        .kh-hero {
            position: relative;
            overflow: hidden;
            padding: 4.4rem 3.2rem 3.8rem;
            margin: 0.5rem 0 2.2rem;
            border: 1px solid var(--kh-line);
            border-radius: 28px;
            background:
                radial-gradient(circle at 85% 15%, #dce9ff 0, transparent 33%),
                linear-gradient(145deg, #ffffff 0%, #f5f8fc 100%);
            box-shadow: 0 18px 55px rgba(29, 54, 92, 0.08);
        }

        .kh-brand {
            display: inline-flex;
            align-items: center;
            gap: 0.55rem;
            padding: 0.45rem 0.8rem;
            margin-bottom: 1.5rem;
            border: 1px solid #cfdbed;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.85);
            color: #355174;
            font-size: 0.88rem;
            font-weight: 700;
        }

        .kh-compass {
            display: inline-grid;
            place-items: center;
            width: 1.7rem;
            height: 1.7rem;
            border-radius: 50%;
            background: var(--kh-blue);
            color: #ffffff;
            font-size: 0.9rem;
        }

        .kh-hero h1 {
            max-width: 760px;
            margin: 0;
            color: var(--kh-ink);
            font-size: clamp(2.35rem, 5.5vw, 4.25rem);
            line-height: 1.16;
            letter-spacing: -0.055em;
        }

        .kh-highlight {
            color: var(--kh-blue);
        }

        .kh-hero p {
            max-width: 650px;
            margin: 1.5rem 0 0;
            color: var(--kh-sub);
            font-size: 1.12rem;
            line-height: 1.85;
            word-break: keep-all;
        }

        .kh-trust-row {
            display: flex;
            flex-wrap: wrap;
            gap: 0.65rem;
            margin-top: 1.6rem;
        }

        .kh-trust {
            padding: 0.48rem 0.72rem;
            border-radius: 9px;
            background: #ffffff;
            border: 1px solid var(--kh-line);
            color: #43516a;
            font-size: 0.86rem;
            font-weight: 650;
        }

        .kh-section-title {
            margin: 2.6rem 0 0.45rem;
            color: var(--kh-ink);
            font-size: 1.65rem;
            font-weight: 800;
            letter-spacing: -0.035em;
        }

        .kh-section-copy {
            margin-bottom: 1.35rem;
            color: var(--kh-sub);
            line-height: 1.7;
        }

        .kh-steps {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }

        .kh-step {
            min-height: 175px;
            padding: 1.4rem;
            border: 1px solid var(--kh-line);
            border-radius: 18px;
            background: #ffffff;
        }

        .kh-step-number {
            display: inline-grid;
            place-items: center;
            width: 2.1rem;
            height: 2.1rem;
            margin-bottom: 1rem;
            border-radius: 11px;
            background: #eaf1ff;
            color: var(--kh-blue-dark);
            font-weight: 850;
        }

        .kh-step h3 {
            margin: 0 0 0.55rem;
            color: var(--kh-ink);
            font-size: 1.08rem;
        }

        .kh-step p {
            margin: 0;
            color: var(--kh-sub);
            font-size: 0.94rem;
            line-height: 1.65;
            word-break: keep-all;
        }

        .kh-note {
            margin: 1.2rem 0 0;
            padding: 1rem 1.15rem;
            border-left: 4px solid #9db9ed;
            border-radius: 8px;
            background: var(--kh-soft);
            color: #526076;
            font-size: 0.88rem;
            line-height: 1.65;
        }

        div.stButton > button[kind="secondary"] {
            min-height: 3.5rem;
            border-radius: 14px !important;
            background: var(--kh-blue) !important;
            border-color: var(--kh-blue) !important;
            font-size: 1.05rem;
            box-shadow: 0 10px 26px rgba(37, 99, 235, 0.18);
        }

        div.stButton > button[kind="secondary"]:hover {
            background: var(--kh-blue-dark) !important;
            border-color: var(--kh-blue-dark) !important;
        }


        .kh-cta-guide {
            max-width: 680px;
            margin: 2.5rem auto 1.1rem;
            text-align: center;
        }

        .kh-cta-guide h2 {
            margin: 0 0 0.6rem;
            color: #172033;
            font-size: 1.55rem;
            letter-spacing: -0.035em;
        }

        .kh-cta-guide p {
            margin: 0;
            color: #667085;
            font-size: 0.96rem;
            line-height: 1.7;
            word-break: keep-all;
        }

        div[data-testid="stButton"] {
            max-width: 680px;
            margin: 0 auto;
        }

        div[data-testid="stButton"] > button {
            min-height: 3.8rem !important;
            border: 1px solid #2563eb !important;
            border-radius: 16px !important;
            background: #2563eb !important;
            color: #ffffff !important;
            font-size: 1.08rem !important;
            font-weight: 800 !important;
            box-shadow: 0 12px 28px rgba(37, 99, 235, 0.22) !important;
        }

        div[data-testid="stButton"] > button:hover {
            background: #1746b0 !important;
            border-color: #1746b0 !important;
            transform: translateY(-1px);
        }

        div[data-testid="stButton"] > button p {
            color: #ffffff !important;
        }

        @media (max-width: 720px) {
            .kh-hero {
                padding: 2.7rem 1.35rem 2.4rem;
                border-radius: 21px;
            }

            .kh-hero h1 {
                font-size: 2.45rem;
            }

            .kh-hero p {
                font-size: 1rem;
            }

            .kh-steps {
                grid-template-columns: 1fr;
            }

            .kh-step {
                min-height: auto;
            }
        }
        </style>

        <div class="kh-home">
            <section class="kh-hero">
                <div class="kh-brand">
                    <span class="kh-compass">↗</span>
                    기칸의 자동차보험 보상 나침반
                </div>

                <h1>
                    사고 뒤,<br>
                    <span class="kh-highlight">약관을 이해하는</span><br>
                    가장 차분한 방법
                </h1>

                <p>
                    사고내용을 말하고 실제 가입담보를 선택하세요.
                    복잡한 자동차보험 약관에서 지금 확인해야 할 보상 항목과
                    관련 원문을 찾아드립니다.
                </p>

                <div class="kh-trust-row">
                    <span class="kh-trust">음성으로 간편 입력</span>
                    <span class="kh-trust">실제 가입담보 중심</span>
                    <span class="kh-trust">약관 원문과 페이지 확인</span>
                </div>
            </section>

            <div class="kh-section-title">세 단계로 확인합니다</div>
            <div class="kh-section-copy">
                많은 정보를 한꺼번에 보여주지 않고, 사고와 가입담보에 필요한 내용부터 확인합니다.
            </div>

            <div class="kh-steps">
                <div class="kh-step">
                    <div class="kh-step-number">1</div>
                    <h3>사고내용 말하기</h3>
                    <p>마이크로 설명하면 음성이 문자로 바뀌며, 잘못 변환된 부분은 직접 수정할 수 있습니다.</p>
                </div>

                <div class="kh-step">
                    <div class="kh-step-number">2</div>
                    <h3>가입담보 선택하기</h3>
                    <p>개인용·업무용·영업용·이륜차 중 보험 종류와 실제 가입담보를 선택합니다.</p>
                </div>

                <div class="kh-step">
                    <div class="kh-step-number">3</div>
                    <h3>약관 근거 확인하기</h3>
                    <p>입력정보에 맞는 보상 검토 내용과 관련 약관 원문 및 PDF 페이지를 확인합니다.</p>
                </div>
            </div>
        </div>
        """
    )

    st.html(
        """
        <div class="kh-cta-guide">
            <h2>내 보험의 보상 내용을 확인해 보세요</h2>
            <p>
                사고내용과 실제 가입담보를 입력하면
                약관을 기준으로 확인할 보상 항목을 정리합니다.
            </p>
        </div>
        """
    )

    if st.button(
        "보상 내역 확인 시작  →",
        key="homepage_start_button",
        use_container_width=True,
    ):
        st.session_state.homepage_started = True
        st.rerun()

    st.html(
        """
        <div class="kh-note">
            이 서비스는 사용자가 보험 내용을 이해하도록 돕는 참고 도구입니다.
            보험회사의 지급 결정, 법률상담 또는 손해사정을 대신하지 않으며
            합의금을 산정하지 않습니다.
        </div>
        """
    )

    st.stop()


# =========================================================
# 화면
# =========================================================

st.title(
    "기칸의 자동차보험 보상 나침반"
)

st.caption(
    "사고내용과 실제 가입담보를 확인해 "
    "약관상 예상 보험금의 계산 준비를 돕습니다."
)

st.warning(
    "합의금, 근거 없는 보험금, "
    "AI가 임의로 정한 과실률은 계산하지 않습니다."
)

st.subheader(
    "1. 사고내용 말하기"
)

st.caption(
    "마이크를 누르고 사고내용을 말한 뒤 종료하세요. "
    "변환된 문장은 바로 아래에서 수정할 수 있습니다."
)

recorded_audio = st.audio_input(
    "녹음 시작",
    key="accident_audio",
    label_visibility="visible",
)

if recorded_audio is not None:
    process_recorded_audio(
        recorded_audio
    )

if st.session_state.get(
    "stt_error"
):
    st.error(
        "음성을 문자로 바꾸지 못했습니다. "
        f"{st.session_state.stt_error}"
    )

    if st.button(
        "같은 녹음 다시 변환",
        key="retry_stt",
    ):
        st.session_state.force_stt_retry = True
        st.session_state.failed_audio_hash = ""
        st.session_state.stt_error = ""
        st.rerun()

elif st.session_state.get(
    "processed_audio_hash"
):
    st.success(
        "문자 변환이 완료되었습니다. "
        "아래 내용을 확인하고 필요한 부분을 수정하세요."
    )

accident_input = st.text_area(
    "사고 내용 및 수정사항",
    key="accident_input_text",
    height=190,
    placeholder=(
        "예: 2026년 9월 24일 오후 2시, "
        "교차로에서 직진 중 상대 차량과 충돌했습니다.\n"
        "부상 여부, 차량 손해, 보험회사가 제시한 과실률도 "
        "아는 범위에서 적어 주세요."
    ),
)

st.subheader(
    "2. 보험 종류와 사용자 입장"
)

selected_insurance_type = st.selectbox(
    "보험 종류 선택",
    options=INSURANCE_TYPE_OPTIONS,
    index=0,
    help=(
        "선택한 보험 종류에 맞는 "
        "가입담보 입력표가 표시됩니다."
    ),
)

selected_position = st.radio(
    "나는 어떤 입장입니까?",
    USER_POSITIONS,
    index=0,
)

st.subheader(
    "3. 보험회사와 가입담보 입력"
)

st.caption(
    "보험회사와 보험기간을 입력하고 "
    "실제 가입한 담보만 선택하세요."
)

storage_key = make_storage_key(
    selected_insurance_type
)

insurer = st.text_input(
    "보험회사",
    key=f"{storage_key}_insurer_v2_20260925_001",
    placeholder="예: 현대해상, 삼성화재",
    autocomplete="off",
)

insurance_period = st.text_input(
    "보험기간",
    key=f"{storage_key}_period_20260925_001",
    placeholder=(
        "예: 2026-01-01 ~ 2026-12-31"
    ),
    autocomplete="off",
)

st.markdown(
    "### 가입담보 입력표"
)

st.caption(
    "담보를 선택하지 않아도 사고내용은 기록할 수 있습니다. "
    "가입담보를 선택하면 가입금액과 자기부담금 "
    "입력칸이 바로 나타납니다."
)

selected_coverages = []

coverage_names = COVERAGES_BY_TYPE.get(
    selected_insurance_type,
    [],
)

for index, coverage_name in enumerate(
    coverage_names
):
    coverage_key = get_coverage_selection_key(
        coverage_name,
        index,
    )

    selected = st.checkbox(
        coverage_name,
        key=coverage_key,
    )

    if selected:
        amount_col, deductible_col = st.columns(2)

        with amount_col:
            amount_key = get_coverage_amount_key(
                coverage_name,
                index,
            )
            amount_value = render_money_input(
                "가입금액·보상한도 직접 입력",
                amount_key,
            )

        with deductible_col:
            deductible_key = get_coverage_deductible_key(
                coverage_name,
                index,
            )
            deductible_value = render_money_input(
                "자기부담금 직접 입력",
                deductible_key,
            )

        saved_amount = format_currency_value(
            amount_value
        )
        saved_deductible = format_currency_value(
            deductible_value
        )

        selected_coverages.append(
            {
                "담보명": coverage_name,
                "가입금액·보상한도": (
                    saved_amount
                ),
                "자기부담금": (
                    saved_deductible
                ),
                "출처 상태": (
                    "사용자 직접 선택"
                ),
            }
        )

selected_names = {
    item["담보명"]
    for item in selected_coverages
}

if (
    "자기신체사고" in selected_names
    and "자동차상해" in selected_names
):
    st.warning(
        "자기신체사고와 자동차상해가 모두 선택되었습니다. "
        "실제 보험증권을 다시 확인해 주세요."
    )

st.caption(
    "부상급수는 사고 당시의 상해 급수이고, 후유장애급수는 치료 후 남은 장애에 관한 급수로 서로 다릅니다. "
    "진단서나 보험회사에서 확인된 급수를 사용자가 직접 선택해야 합니다. "
    "앱이 사고 설명만 보고 부상급수나 후유장애급수를 임의로 판정하지 않습니다."
)

injury_grade = st.selectbox(
    "부상급수",
    INJURY_GRADE_OPTIONS,
    index=1,
)

disability_grade = st.selectbox(
    "후유장애급수",
    INJURY_GRADE_OPTIONS,
    index=1,
)

hospital_days = st.number_input(
    "입원일수",
    min_value=0,
    value=0,
    step=1,
    format="%d",
    help="입원하지 않았다면 0일로 입력하세요. 음수와 소수는 입력할 수 없습니다.",
)

st.markdown("### 보험금 산정 중요 전제조건")
st.caption("아래 전제조건은 약관상 배상책임과 자기부담금 산정에 영향을 줄 수 있습니다. 확인되지 않은 값은 ‘확인 필요’로 남겨두세요.")

preconditions = {}
precondition_options = {
    "상대 차량 보험가입 상태": ["의무보험만 가입", "대인배상Ⅱ까지 가입", "무보험", "확인되지 않음", "상대 차량 없음"],
    "무보험자동차상해 적용 검토": ["해당 없음", "적용 검토 필요", "확인되지 않음"],
    "사고 운전자 면허 상태": ["유효한 면허", "무면허", "면허정지 중", "면허취소 상태", "확인되지 않음"],
    "음주운전 여부": ["아니요", "예", "확인되지 않음"],
    "마약·약물운전 여부": ["아니요", "예", "확인되지 않음"],
    "사고발생 후 조치의무 위반 여부": ["아니요", "예", "확인되지 않음"],
    "운전자 범위 한정특약 위반 여부": ["아니요", "예", "확인되지 않음"],
    "운전자 연령 한정특약 위반 여부": ["아니요", "예", "확인되지 않음"],
    "피보험자동차 해당 여부": ["예", "아니요", "확인되지 않음"],
    "차량 사용에 대한 피보험자의 허락 여부": ["허락받음", "허락받지 않음", "확인되지 않음", "해당 없음"],
    "보험증권상 차량 용도와 실제 사용 목적 일치 여부": ["일치함", "일치하지 않음", "확인되지 않음"],
    "고의사고 여부": ["아니요", "예", "확인되지 않음"],
    "안전벨트 또는 안전모 착용 여부": ["착용", "미착용", "확인되지 않음", "해당 없음"],
}

columns = st.columns(2)
for idx, (label, options) in enumerate(precondition_options.items()):
    with columns[idx % 2]:
        value = st.selectbox(label, options, index=options.index("확인되지 않음") if "확인되지 않음" in options else 0, help=f"{label}에 대한 확인 상태입니다.")
        preconditions[label] = value

other_insurance_amount = st.text_input(
    "다른 보험이나 상대 보험사에서 이미 받은 금액",
    value="0",
    help="쉼표가 자동으로 표시됩니다. 중복 지급 검토용입니다.",
)
preconditions["다른 보험이나 상대 보험사에서 이미 받은 금액"] = format_currency_value(other_insurance_amount)

preconditions["사고일"] = "사고 당시 적용 약관을 판단하는 기준일로 사용"

st.markdown("### 사용자 측 적용 과실비율")
user_fault_rate = st.selectbox(
    "사용자 측 적용 과실비율",
    ["아직 정해지지 않음"] + [f"{value}%" for value in range(0, 101, 10)],
    index=0,
)
if user_fault_rate != "아직 정해지지 않음":
    user_fault_value = int(user_fault_rate.replace('%', ''))
    if preconditions.get("상대 차량 보험가입 상태") != "상대 차량 없음":
        opponent_fault_value = max(0, 100 - user_fault_value)
        st.caption(f"상대방 측 과실비율: {opponent_fault_value}%")
else:
    opponent_fault_value = None

fault_source = st.radio(
    "과실비율 출처",
    [
        "아직 정해지지 않음",
        "양측 보험회사 협의",
        "자동차사고 과실비율 분쟁심의위원회",
        "법원 판결 또는 조정",
        "당사자 합의",
        "사용자가 임시로 입력한 값",
    ],
    index=0,
)

fault_rate = f"{user_fault_rate} · {fault_source}"
if user_fault_rate == "아직 정해지지 않음":
    fault_rate = f"{user_fault_rate} · {fault_source}"
else:
    fault_rate = f"{user_fault_rate} · {fault_source}"

render_actual_cost_inputs(
    selected_coverages
)

submitted = st.button(
    "입력내용 확인",
    key="confirm_inputs",
)

if submitted:
    st.session_state.analysis_result = (
        build_analysis_summary(
            position=selected_position,
            accident_text=accident_input,
            insurance_type=(
                selected_insurance_type
            ),
            insurer=insurer,
            insurance_period=(
                insurance_period
            ),
            injury_grade=injury_grade,
            disability_grade=disability_grade,
            hospital_days=hospital_days,
            fault_rate=fault_rate,
            selected_coverages=(
                selected_coverages
            ),
            preconditions=preconditions,
        )
    )
    result = st.session_state["analysis_result"]
    render_input_review_tables(result)
    render_policy_analysis_result(result)

    render_policy_question_section(result)


# =========================================================
# 입력 결과
# =========================================================

result = st.session_state.get(
    "analysis_result"
)

if result and not submitted:
    render_input_review_tables(result)
    render_policy_analysis_result(result)
    render_policy_question_section(result)

    st.info(
        "현재 단계는 음성변환과 가입정보 입력을 "
        "안정화한 단계입니다. "
        "약관상 예상 보험금은 해당 보험사의 실제 약관 PDF에서 "
        "지급기준·면책·공제·한도를 검증한 뒤 계산해야 합니다."
    )


st.divider()

st.caption(
    "이 서비스는 사용자가 제공한 보험증권, 사고정보와 "
    "자동차보험 약관을 바탕으로 약관상 예상 보험금을 "
    "정리하기 위한 참고 도구입니다. "
    "실제 지급 여부와 금액은 보험회사의 사고 조사, "
    "확정된 과실률, 실제 보험계약, 제출서류와 "
    "사고일 당시 약관 및 법령에 따라 달라질 수 있습니다. "
    "이 서비스는 법률상담, 손해사정, "
    "국가기관의 유권해석 또는 보험회사의 지급결정을 "
    "대신하지 않으며 합의금을 산정하지 않습니다."
)
