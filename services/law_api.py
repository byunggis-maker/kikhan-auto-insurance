import os
import requests
from dotenv import load_dotenv


# 프로젝트의 .env 파일 읽기
load_dotenv()

LAW_API_OC = os.getenv("LAW_API_OC")


def search_law(query):
    """
    국가법령정보 공동활용 Open API에서
    법령을 검색합니다.
    """

    if not LAW_API_OC:
        return {
            "success": False,
            "message": "LAW_API_OC가 .env에 설정되어 있지 않습니다."
        }

    url = "https://www.law.go.kr/DRF/lawSearch.do"

    params = {
        "OC": LAW_API_OC,
        "target": "law",
        "type": "XML",
        "query": query,
        "display": 10,
    }

    try:
        response = requests.get(
            url,
            params=params,
            timeout=15,
        )

        response.raise_for_status()

        return {
            "success": True,
            "status_code": response.status_code,
            "text": response.text,
        }

    except requests.RequestException as e:
        return {
            "success": False,
            "message": str(e),
        }


# 이 파일을 직접 실행했을 때 테스트
if __name__ == "__main__":

    print("법제처 Open API 연결 테스트")
    print("-" * 40)

    result = search_law("자동차손해배상 보장법")

    if result["success"]:
        print("API 연결 성공")
        print()
        print(result["text"][:3000])

    else:
        print("API 연결 실패")
        print(result["message"])