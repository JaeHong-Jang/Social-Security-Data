"""정보원 복지서비스 API(지자체·중앙부처) 목록+상세를 내려받아 JSON 캐시로 저장한다.
사용: python prototype/scripts/fetch_welfare.py [시도명]   (기본: 서울특별시)
이미 받은 캐시 파일은 건너뛴다.
"""
import json, os, sys, time, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KEY = next(l.split("=", 1)[1].strip() for l in open(ROOT / ".env") if l.startswith("DATA_GO_KR_KEY="))
BASE = "https://apis.data.go.kr/B554287"
OUT = ROOT / "data" / "cache"


def call(path, **params):
    q = urllib.parse.urlencode(params)  # serviceKey는 이미 URL 인코딩된 키라 따로 붙인다
    url = f"{BASE}/{path}?serviceKey={KEY}&{q}"
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return ET.fromstring(r.read())
        except Exception as e:
            if attempt == 5:
                raise
            time.sleep(5 * (attempt + 1))  # 429(호출 속도 제한) 대비 점진적 대기


def flat(el):
    """XML 요소를 dict로. 반복 태그(…List)는 리스트로 모은다."""
    d = {}
    for c in el:
        v = flat(c) if len(c) else (c.text or "").replace("\r", "\n").strip()
        if c.tag in d:
            d[c.tag] = d[c.tag] if isinstance(d[c.tag], list) else [d[c.tag]]
            d[c.tag].append(v)
        else:
            d[c.tag] = v
    return d


def fetch(kind, list_path, detail_path, list_params, detail_params):
    part = OUT / f"{kind}.partial.json"  # 중간 저장: 중단돼도 이어받기
    items = json.loads(part.read_text()) if part.exists() else []
    if not items:
        page = 1
        while True:
            root = call(list_path, pageNo=page, numOfRows=100, **list_params)
            assert root.findtext("resultCode") == "0", root.findtext("resultMessage")
            rows = [flat(s) for s in root.findall("servList")]
            items += rows
            total = int(root.findtext("totalCount"))
            if len(items) >= total or not rows:
                break
            page += 1
            time.sleep(1)
    for i, it in enumerate(items):
        if "detail" in it:
            continue
        it["detail"] = flat(call(detail_path, servId=it["servId"], **detail_params))
        if i % 25 == 0:
            part.write_text(json.dumps(items, ensure_ascii=False))
            print(kind, i, "/", len(items), flush=True)
        time.sleep(1)
    path = OUT / f"{kind}.json"
    path.write_text(json.dumps({"fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                                "total": len(items), "items": items}, ensure_ascii=False, indent=1))
    part.unlink(missing_ok=True)
    print(kind, len(items), "->", path)


if __name__ == "__main__":
    sido = sys.argv[1] if len(sys.argv) > 1 else "서울특별시"
    OUT.mkdir(parents=True, exist_ok=True)
    if not (OUT / f"local_{sido}.json").exists():
        fetch("local_" + sido, "LocalGovernmentWelfareInformations/LcgvWelfarelist",
              "LocalGovernmentWelfareInformations/LcgvWelfaredetailed", {"ctpvNm": sido}, {})
    if not (OUT / "central.json").exists():
        fetch("central", "NationalWelfareInformationsV001/NationalWelfarelistV001",
              "NationalWelfareInformationsV001/NationalWelfaredetailedV001",
              {"callTp": "L", "srchKeyCode": "003"}, {"callTp": "D"})
