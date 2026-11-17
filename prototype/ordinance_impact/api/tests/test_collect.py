import json

import pytest

from prototype.ordinance_impact.api.collect import (
    CollectionError, extract_html, parse_bokjiro, parse_ordinance,
    parse_welfare_xml, parse_statistics, validate_url, collect,
)


def test_html_excludes_executable_content_and_preserves_provisions():
    text, fields = extract_html('<input id="ordinNm" value="가상 시험 조례"><script>private()</script><style>.hidden{}</style><p>제1조 목적</p><p>부칙 적용례</p>')
    assert 'private' not in text
    assert 'hidden' not in text
    assert '제1조 목적' in text and '부칙 적용례' in text
    assert fields['ordinNm'] == '가상 시험 조례'


def test_public_projection_discards_unnecessary_internal_metadata():
    value = {'initValue': {
        'dmWlfareInfo': json.dumps({'wlfareInfoId': 'TEST1', 'wlfareInfoNm': '가상 사업', 'wlfareSprtTrgtCn': '<p>시험 대상</p>', 'lastChgUsrIpadr': 'private-test-address', 'lastChgUsrid': 'private-test-author'}),
        'dsWlfareInfoDtl': json.dumps([{'wlfareInfoDtlCd': '030', 'wlfareInfoReldNm': '시험 조례', 'wlfareInfoReldCn': '시험 근거', 'author': 'private-test-author'}]),
    }}
    html = '<script>cpr.core.Platform.INSTANCE.initParameter(' + json.dumps(value) + ');</script>'
    projection, text = parse_bokjiro(html, 'TEST1')
    assert projection['service']['wlfareInfoId'] == 'TEST1'
    assert projection['legalBases'][0]['name'] == '시험 조례'
    assert '시험 대상' in text and '시험 근거' in text
    assert 'private-test' not in json.dumps(projection) + text
    with pytest.raises(CollectionError):
        parse_bokjiro(html, 'OTHER')


def test_ordinance_requires_expected_identity_and_real_provisions():
    html = '<input id="ordinNm" value="시험 조례"><input id="ordinSeq" value="123"><input id="ordinId" value="456"><input id="ancYd" value="20260101"><p>[시행 2026. 2. 1.]</p><p>제1조 목적</p><p>부칙 제1조 시행</p>'
    doc = parse_ordinance(html, {'title': '시험 조례', 'ordinSeq': '123', 'ordinId': '456'})
    assert doc['version']['promulgatedDate'] == '2026-01-01'
    assert doc['version']['effectiveDate'] == '2026-02-01'
    with pytest.raises(CollectionError):
        parse_ordinance(html, {'title': '시험 조례', 'ordinSeq': '999', 'ordinId': '456'})
    with pytest.raises(CollectionError):
        parse_ordinance('<html>접근이 차단되었습니다</html>', {'title': '시험 조례', 'ordinSeq': '123'})


def test_parent_law_preserves_version_identity_and_dates():
    from prototype.ordinance_impact.api.collect import parse_law
    html = '<input id="lsNm" value="시험법"><input id="lsId" value="001"><input id="lsiSeq" value="123"><input id="ancYd" value="20260512"><input id="efYd" value="20261113"><p>제1조 시험</p>'
    doc = parse_law(html, {'title': '시험법', 'lsiSeq': '123', 'lsId': '001'})
    assert doc['version']['effectiveDate'] == '2026-11-13'
    assert doc['version']['promulgatedDate'] == '2026-05-12'
    assert doc['legalInstrumentId'] == 'law:001'
    with pytest.raises(CollectionError):
        parse_law(html, {'title': '다른법', 'lsiSeq': '123', 'lsId': '001'})


@pytest.mark.parametrize('url', [
    'http://www.law.go.kr/LSW/a', 'https://localhost/a',
    'https://127.0.0.1/a', 'https://www.law.go.kr:123/a',
    'https://user:password@www.law.go.kr/LSW/a', 'https://example.com/a',
])
def test_only_registered_https_origins_are_allowed(url):
    with pytest.raises(CollectionError):
        validate_url(url, resolve=False)


def test_welfare_xml_checks_result_codes_and_repeated_legal_bases():
    raw = b'<response><resultCode>0</resultCode><totalCount>1</totalCount><servList><servId>TEST1</servId><servNm>Test</servNm></servList></response>'
    rows, total = parse_welfare_xml(raw)
    assert rows[0]['servId'] == 'TEST1' and total == 1
    with pytest.raises(CollectionError):
        parse_welfare_xml(b'<response><resultCode>30</resultCode><resultMessage>key-error</resultMessage></response>')
    with pytest.raises(CollectionError):
        parse_welfare_xml(b'<html>blocked</html>')


@pytest.mark.parametrize('raw', [
    b'<response><resultCode>0</resultCode></response>',
    b'<response><resultCode>0</resultCode><totalCount>-1</totalCount></response>',
    b'<response><resultCode>0</resultCode><totalCount>0</totalCount><servList><servId>T</servId></servList></response>',
    b'<response><resultCode>0</resultCode><totalCount>1</totalCount><servList><servNm>T</servNm></servList></response>',
])
def test_incomplete_welfare_payload_cannot_be_live_success(raw):
    with pytest.raises(CollectionError):
        parse_welfare_xml(raw)


def test_statistics_decode_cp949_and_keep_aggregates_separate():
    raw = '사업명,기준년월,시도,시군구,수급권자수,수급가구수\n가상사업,202512,시험시,시험구,10,5\n'.encode('cp949')
    item, text = parse_statistics(raw)
    assert item['recordCount'] == 1
    assert item['previewRows'][0]['시군구'] == '시험구'
    assert item['columns'] == ['사업명', '기준년월', '시도', '시군구', '수급권자수', '수급가구수']
    assert '수급권자수' in text
    with pytest.raises(CollectionError):
        parse_statistics(b'<html>not csv</html>')


def test_offline_collection_preserves_cache_dates_and_does_not_invent_live_data(tmp_path):
    repo = tmp_path / 'repo'
    cache = repo / 'data/cache'
    cache.mkdir(parents=True)
    (cache / 'local_list_전국.json').write_text(json.dumps({'saved_at': '2026-11-13 16:39:22', 'complete': True, 'items': [{'servId': 'TEST1', 'servNm': '가상 시험 사업'}]}))
    (cache / 'local_서울특별시.json').write_text(json.dumps({'fetched_at': '2026-11-13 00:14:18', 'items': [{'servId': 'TEST1', 'servNm': '가상 시험 사업', 'detail': {'resultCode': '0', 'sprtTrgtCn': '시험 대상', 'baslawList': {'wlfareInfoReldNm': '시험 조례'}}}]}))
    (cache / 'central.partial.json').write_text(json.dumps([{'servId': 'TEST2', 'servNm': '가상 중앙 시험 사업'}]))
    manifest = tmp_path / 'sources.json'
    manifest.write_text(json.dumps({'sources': [], 'documents': []}))
    def forbidden_fetch(*args, **kwargs):
        raise AssertionError('offline collection must not make network calls')
    result = collect(repo, tmp_path / 'out', manifest, online=False, fetcher=forbidden_fetch, credentials={})
    assert len(result['services']) == 2
    local = next(x for x in result['services'] if x['kind'] == 'local')
    central = next(x for x in result['services'] if x['kind'] == 'central')
    assert local['detailStatus'] == 'collected'
    assert local['fetchedAt'].startswith('2026-11-13')
    assert central['fetchedAt'] is None
    assert central['detailStatus'] == 'missing'
    assert result['documents'] == []
    assert all(x['status'] != 'live' for x in result['sources'])


def test_failed_document_is_not_a_snapshot_or_a_success(tmp_path):
    manifest = tmp_path / 'sources.json'
    manifest.write_text(json.dumps({
        'sources': [{'id': 'ordinance-web', 'name': '시험 출처', 'provider': '시험기관', 'kind': 'ordinance', 'homepageUrl': 'https://www.law.go.kr', 'message': ''}],
        'documents': [{'id': 'test-doc', 'sourceId': 'ordinance-web', 'kind': 'ordinance', 'title': '시험 조례', 'sourceUrl': 'https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=1', 'ordinSeq': '1', 'relatedServiceIds': []}],
    }))
    def failed(url, **kwargs):
        raise CollectionError('NETWORK_ERROR', '출처 응답 실패')
    result = collect(tmp_path, tmp_path / 'out', manifest, online=True, fetcher=failed, credentials={})
    assert not result['documents']
    source = next(x for x in result['sources'] if x['id'] == 'ordinance-web')
    assert source['status'] == 'blocked'
    assert source['recordCount'] == 0
    assert source['snapshotIds'] == []


def test_failed_refresh_retains_prior_evidence_and_original_observed_time(tmp_path):
    from prototype.ordinance_impact.api.store import SnapshotStore
    store = SnapshotStore(tmp_path / 'out')
    previous = store.save('ordinance-web', 'https://www.law.go.kr/LSW/test', b'previous', '기존 실제 관측', 'text/plain', fetched_at='2026-11-13T00:00:00Z')
    document = {'id': 'old-doc', 'sourceId': 'ordinance-web', 'snapshotId': previous['id'], 'fetchedAt': previous['fetchedAt'], 'kind': 'ordinance', 'title': '시험 조례', 'text': previous['text']}
    store.save_catalog({'schemaVersion': 1, 'generatedAt': '2026-11-13T00:00:00Z', 'sources': [], 'services': [], 'documents': [document], 'statistics': []})
    manifest = tmp_path / 'sources.json'
    manifest.write_text(json.dumps({'sources': [{'id': 'ordinance-web', 'name': '시험 출처', 'provider': '시험기관', 'kind': 'ordinance', 'homepageUrl': 'https://www.law.go.kr'}], 'documents': [{'id': 'old-doc', 'sourceId': 'ordinance-web', 'kind': 'ordinance', 'title': '시험 조례', 'sourceUrl': 'https://www.law.go.kr/LSW/test', 'ordinSeq': '1'}]}))
    def failed(url, **kwargs):
        raise CollectionError('NETWORK_ERROR', '재수집 실패')
    result = collect(tmp_path, tmp_path / 'out', manifest, online=True, fetcher=failed, credentials={})
    assert result['documents'] == [document]
    source = next(x for x in result['sources'] if x['id'] == 'ordinance-web')
    assert source['status'] == 'partial'
    assert source['fetchedAt'] == '2026-11-13T00:00:00Z'
    assert '재수집 실패' in source['message']


def test_file_download_stops_when_portal_requires_captcha():
    from prototype.ordinance_impact.api.collect import download_statistics
    responses = [json.dumps({'status': True, 'atchFileId': 'FILE_123', 'fileDetailSn': 1}).encode(), json.dumps({'needCaptcha': True}).encode()]
    calls = []
    def fake(url, **kwargs):
        calls.append(url)
        return responses.pop(0), 'application/json'
    with pytest.raises(CollectionError, match='사람 확인'):
        download_statistics({'publicDataPk': '1', 'publicDataDetailPk': 'test', 'downloadName': 'test'}, fake)
    assert len(calls) == 2


@pytest.mark.parametrize('online', [True, False])
def test_live_only_service_survives_failed_or_offline_refresh(tmp_path, online):
    from prototype.ordinance_impact.api.store import SnapshotStore
    from prototype.ordinance_impact.api.normalizers import normalize_service
    store = SnapshotStore(tmp_path / 'out')
    snap = store.save('local-welfare', 'https://www.data.go.kr/data/15108347/openapi.do', b'previous service', '기존 실제 사업', 'text/plain', fetched_at='2026-11-16T00:00:00Z')
    service = normalize_service({'servId': 'LIVE-ONLY', 'servNm': '이전 성공 시 확보한 시험 사업'}, 'local', 'local-welfare', snap['fetchedAt'], snap['id'])
    source = {'id': 'local-welfare', 'fetchedAt': snap['fetchedAt'], 'status': 'live', 'recordCount': 1, 'totalCount': 1, 'snapshotIds': [snap['id']]}
    store.save_catalog({'schemaVersion': 1, 'generatedAt': snap['fetchedAt'], 'sources': [source], 'services': [service], 'documents': [], 'statistics': []})
    manifest = tmp_path / 'sources.json'
    manifest.write_text(json.dumps({'sources': [], 'documents': []}))
    def failed(url, **kwargs):
        raise CollectionError('NETWORK_ERROR', '현재 수집 실패')
    result = collect(tmp_path, tmp_path / 'out', manifest, online=online, fetcher=failed, credentials={'DATA_GO_KR_KEY': 'test-only-never-persist'})
    assert result['services'] == [service]
    current = next(x for x in result['sources'] if x['id'] == 'local-welfare')
    assert current['fetchedAt'] == snap['fetchedAt']
    assert current['status'] == ('partial' if online else 'cache')
    assert 'test-only-never-persist' not in json.dumps(result)


@pytest.mark.parametrize('totals', [(201, 100), (150, 150)])
def test_welfare_page_totals_must_be_consistent_and_exact(tmp_path, totals, monkeypatch):
    from prototype.ordinance_impact.api.collect import collect_welfare, source_record
    from prototype.ordinance_impact.api.store import SnapshotStore
    monkeypatch.setattr('prototype.ordinance_impact.api.collect.time.sleep', lambda _: None)
    responses = []
    for page, total in enumerate(totals):
        rows = ''.join(f'<servList><servId>TEST-{page}-{i}</servId><servNm>Test</servNm></servList>' for i in range(100))
        responses.append(f'<response><resultCode>0</resultCode><totalCount>{total}</totalCount>{rows}</response>'.encode())
    def fake(url, **kwargs):
        return responses.pop(0), 'application/xml'
    source = source_record('local-welfare', '시험', 'local_welfare', 'https://www.data.go.kr')
    with pytest.raises(CollectionError):
        collect_welfare('local', 'test-key', SnapshotStore(tmp_path), fake, [], source)
    assert source['status'] != 'live'
