"""F1 키워드 규칙 기준선 — LLM 없이 같은 F1ResultV2를 만든다(비교용).

일치한 키워드가 들어 있는 문장을 근거 인용으로 붙인다. 규칙은 단순한 정규식이며 부정·범위 표현에 약하다.
"""
import re

from prototype.api.schemas import Evidence
from prototype.api.schemas_v2 import F1ResultV2

MODEL = "baseline:keyword-v2"  # v2: 장벽 원인 규칙 추가
# (값, 정규식) — 위에서부터 먼저 맞는 것을 쓴다
WORK = [("조사중", r"재확인|재방문 예정|확인 예정|보완 후|추가 확인|조사 ?중"), ("종결", r"종결")]
CLOSURE = [("C", r"조사불가|연락(이)? ?두절|만나지 못|연락이 닿지"),
           ("A", r"기준.{0,4}초과|초과(하여|해)"),
           ("B", r"지원제외|제외 대상|중복|이미 .{0,8}받"),
           ("D3", r"해소|해결됐|해결되었|취업|출근|나아졌|괜찮아졌"),
           ("D1", r"서류|나중에|미루|미룸|떼러|힘이 없"),
           ("D2", r"필요 없|필요없|원하지 않|생각(이)? 없|잘 모르")]
# 장벽 원인: 신청 보류(장벽)·D1일 때만 찾는다. 위에서부터 우선(서류·절차 > 건강 > 시간·생계 > 기타)
CAUSE = [("서류·절차", r"서류|절차|떼러|떼는|등본|사본|증명서|신청 방법|복잡"),
         ("건강", r"아파|아프|아픈|힘이 없|기력|거동|몸이|수술|통증|치료"),
         ("시간·생계", r"시간이 없|시간이 안|짬이|바빠|바쁘|일하느라|일 때문|생업"),
         ("기타", r"멀어|멀다|엄두|눈치|창피|부끄")]
APPLY = [("보류(장벽)", r"서류|힘이 없|떼러|미루|미룸|나중에"),
         ("거부", r"신청.{0,10}(생각(이)? 없|않|안 하|거부)|필요 없"),
         ("동의", r"신청하겠|신청 의사|신청함")]
SMS = [("거부", r"문자.{0,10}(싫|거부|원하지 않|받지 않)"), ("동의", r"문자.{0,10}(괜찮|좋|받겠|된다|동의)")]
VISIT = [("거부", r"(방문|찾아오).{0,10}(싫|거부|원하지 않|오지 말)"), ("동의", r"(방문|찾아오).{0,10}(괜찮|좋|된다|동의)")]
NETWORK = [("부재", r"연락(하는|할) (가족|사람).{0,4}없|연락.{0,4}끊|도와줄 사람.{0,4}없|왕래.{0,4}없|의지할 .{0,6}없"),
           ("있음", r"(딸|아들|자녀|가족|이웃|동생|언니|형|누나|오빠)(이|가) .{0,12}(챙|돕|도와|보태|들르)")]
ISO = [("우편물 적체", r"우편물|고지서.{0,6}쌓"), ("반복 부재", r"(\d+|두|세|네|여러) ?(차례|번).{0,10}(부재|만나지 못|응답 없|문을 열지)"),
       ("단전", r"전기.{0,6}끊|단전된"), ("단수", r"물.{0,4}끊|단수된")]


def _sentences(memo: str):
    for m in re.finditer(r"[^.!?\n]+[.!?]?", memo):
        s, e = m.start(), m.end()
        while s < e and memo[s].isspace():
            s += 1
        if s < e:
            yield s, e


def _find(memo: str, rules) -> tuple[str, tuple[int, int]] | None:
    for value, pat in rules:
        for s, e in _sentences(memo):
            if re.search(pat, memo[s:e]):
                return value, (s, e)
    return None


def classify(memo: str) -> F1ResultV2:
    ev = []

    def pick(field, rules, default):
        hit = _find(memo, rules)
        if not hit:
            return default
        v, (s, e) = hit
        ev.append(Evidence(field=field if not field.endswith(".") else field + v, quote=memo[s:e], start=s, end=e))
        return v

    ws = pick("work_status", WORK, "판단보류")
    ct = pick("closure_type", CLOSURE, None) if ws == "종결" else None
    if ws == "종결" and ct is None:
        ws = "판단보류"
    consent = {"신청": pick("consent.신청", APPLY, "미확인"), "문자": pick("consent.문자", SMS, "미확인"),
               "방문": pick("consent.방문", VISIT, "미확인")}
    held = consent["신청"] == "보류(장벽)" or ct == "D1"
    cause = pick("barrier_cause", CAUSE, "미확인") if held else "해당없음"
    net = pick("support_network", NETWORK, "미확인")
    iso = [v for v, pat in ISO if pick("isolation_signals.", [(v, pat)], None)]
    return F1ResultV2(work_status=ws, closure_type=ct, barrier_cause=cause, consent=consent, support_network=net, isolation_signals=iso,
                      evidence=ev, needs_check=ws == "판단보류",
                      needs_check_reason="키워드 규칙으로 업무상태를 정하지 못했습니다" if ws == "판단보류" else None,
                      model=MODEL)
