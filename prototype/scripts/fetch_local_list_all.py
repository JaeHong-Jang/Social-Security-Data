"""전국 지자체 복지서비스 '목록'(LcgvWelfarelist)만 시도별로 내려받아 data/cache/local_list_전국.json 에 저장.
- 상세(Lcgvwelfaredetailed)는 호출하지 않는다(쿼터 보호).
- 이어받기: 저장된 (시도, 다음 페이지) 상태에서 재개. 429/연속 오류 시 현재까지 저장하고 종료(exit 2).
- 키는 .env에서 읽기만 하며 URL/키를 출력하지 않는다.
사용: python fetch_local_list_all.py            (전체)   |  --probe  (시도명별 totalCount만 확인)
"""
import json, sys, time, urllib.request, urllib.parse, urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEY = next(l.split("=", 1)[1].strip() for l in open(ROOT / ".env") if l.startswith("DATA_GO_KR_KEY="))
URL = "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist"
OUT = ROOT / "data" / "cache" / "local_list_전국.json"
# 2026년 광주광역시+전라남도는 API상 "전남광주통합특별시"(555건)로 통합되어 있다(구 명칭 조회는 NO DATA).
SIDO = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "대전광역시", "울산광역시",
        "세종특별자치시", "경기도", "충청북도", "충청남도", "전남광주통합특별시", "경상북도", "경상남도",
        "제주특별자치도", "강원특별자치도", "전북특별자치도"]


class RateLimited(Exception):
    pass


def call(sido, page):
    q = urllib.parse.urlencode({"pageNo": page, "numOfRows": 100, "ctpvNm": sido})
    url = f"{URL}?serviceKey={KEY}&{q}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return ET.fromstring(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise RateLimited()
            err = f"HTTP {e.code}"
        except Exception as e:
            err = type(e).__name__  # 메시지에 URL이 들어갈 수 있어 타입명만 남긴다
        time.sleep(5 * (attempt + 1))
    raise RuntimeError("호출 실패: " + err)


def flat(el):
    return {c.tag: (c.text or "").replace("\r", "\n").strip() for c in el if not len(c)}


def save(state):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    state["saved_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    OUT.write_text(json.dumps(state, ensure_ascii=False))


def main():
    if "--probe" in sys.argv:
        for s in SIDO:
            r = call(s, 1)
            print(s, r.findtext("resultCode"), r.findtext("totalCount"))
            time.sleep(1)
        return 0
    st = json.loads(OUT.read_text()) if OUT.exists() else {"items": [], "progress": {}, "totals": {}, "complete": False}
    try:
        for s in SIDO:
            pr = st["progress"].get(s, {"next_page": 1, "done": False})
            while not pr["done"]:
                r = call(s, pr["next_page"])
                if r.findtext("resultCode") != "0":
                    raise RuntimeError(f"{s} resultCode={r.findtext('resultCode')} {r.findtext('resultMessage')}")
                rows = [flat(x) for x in r.findall("servList")]
                total = int(r.findtext("totalCount"))
                st["totals"][s] = total
                st["items"] += rows
                got = sum(1 for i in st["items"] if i.get("ctpvNm") == s)
                pr["next_page"] += 1
                pr["done"] = (not rows) or pr["next_page"] > -(-total // 100)
                st["progress"][s] = pr
                save(st)
                print(s, "page", pr["next_page"] - 1, "rows_so_far", got, "/", total, flush=True)
                time.sleep(1)
            st["progress"][s] = pr
        st["complete"] = True
        save(st)
        print("완료", len(st["items"]))
        return 0
    except RateLimited:
        save(st)
        print("429 수신: 저장 후 중단. 나중에 재실행하면 이어받는다.", len(st["items"]))
        return 2
    except Exception as e:
        save(st)
        print("중단:", type(e).__name__, str(e)[:200])
        return 3


if __name__ == "__main__":
    sys.exit(main())
