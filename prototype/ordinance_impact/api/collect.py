"""Explicit, bounded public-source collection; credentials never enter the catalog."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import ipaddress
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

from .normalizers import merge_services, normalize_service
from .store import SnapshotStore

REPO = Path(__file__).resolve().parents[3]
ALLOWED_HOSTS = {'www.law.go.kr', 'open.law.go.kr', 'www.bokjiro.go.kr', 'www.data.go.kr', 'apis.data.go.kr', 'www.sd.go.kr'}
MAX_BYTES = 4 * 1024 * 1024
LOCAL_API = 'https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/'
CENTRAL_API = 'https://apis.data.go.kr/B554287/NationalWelfareInformationsV001/'
PUBLIC_FIELDS = ('wlfareInfoId', 'wlfareInfoNm', 'wlfareInfoOutlCn', 'wlfareSprtTrgtCn', 'wlfareSprtTrgtSlcrCn', 'wlfareSprtBnftCn', 'aplyMtdDc', 'lastChgPtm')


class CollectionError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def validate_url(url: str, resolve=True):
    p = urllib.parse.urlsplit(url)
    try:
        valid_port = p.port in (None, 443)
    except ValueError:
        valid_port = False
    if p.scheme != 'https' or p.hostname not in ALLOWED_HOSTS or p.username or p.password or not valid_port:
        raise CollectionError('URL_NOT_ALLOWED', '등록한 공식 HTTPS 출처가 아닙니다.')
    if resolve:
        try:
            addresses = socket.getaddrinfo(p.hostname, 443, type=socket.SOCK_STREAM)
        except OSError:
            raise CollectionError('DNS_ERROR', '공식 출처 주소 확인에 실패했습니다.') from None
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise CollectionError('NON_PUBLIC_ADDRESS', '공개 네트워크 주소가 아닙니다.')


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        if urllib.parse.urlsplit(newurl).hostname != urllib.parse.urlsplit(req.full_url).hostname:
            raise CollectionError('CROSS_ORIGIN_REDIRECT', '다른 출처로의 자동 이동을 중단했습니다.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_public(url, *, data=None):
    validate_url(url)
    headers = {'User-Agent': 'OrdinanceImpactLocal/0.1 (public research; bounded requests)'}
    if data is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.build_opener(PublicRedirect()).open(request, timeout=18) as response:
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise CollectionError('TOO_LARGE', '허용한 원문 크기를 초과했습니다.')
            return raw, response.headers.get('Content-Type', 'application/octet-stream')
    except CollectionError:
        raise
    except urllib.error.HTTPError as error:
        raise CollectionError('HTTP_ERROR', f'공식 출처 HTTP {error.code} 응답입니다.') from None
    except (OSError, urllib.error.URLError, ValueError):
        raise CollectionError('NETWORK_ERROR', '공식 출처 연결·인증서·응답 확인에 실패했습니다.') from None


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.fields = [], {}
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.skip += 1
        if tag == 'input':
            a = dict(attrs)
            if a.get('id') in ('ordinNm', 'ordinSeq', 'ordinId', 'ancYd', 'lsNm', 'lsiSeq', 'lsId', 'efYd'):
                self.fields[a['id']] = a.get('value', '')
        if not self.skip and tag in ('br', 'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            self.skip = max(0, self.skip - 1)
        if not self.skip and tag in ('p', 'div', 'li', 'tr'):
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def extract_html(html):
    parser = TextExtractor()
    parser.feed(html)
    text = '\n'.join(re.sub(r'[ \t\r\f\v]+', ' ', line).strip() for line in ''.join(parser.parts).splitlines())
    return re.sub(r'\n{3,}', '\n\n', text).strip(), parser.fields


def parse_bokjiro(html, expected_id):
    marker = 'initParameter('
    pos = html.find(marker)
    if pos < 0:
        raise CollectionError('MISSING_PUBLIC_DATA', '복지로 공개 안내 데이터를 찾지 못했습니다.')
    try:
        init, _ = json.JSONDecoder().raw_decode(html[pos + len(marker):].lstrip())
        values = init['initValue']
        detail = values['dmWlfareInfo']
        detail = json.loads(detail) if isinstance(detail, str) else detail
        related = values.get('dsWlfareInfoDtl', [])
        related = json.loads(related) if isinstance(related, str) else related
    except (ValueError, KeyError, TypeError):
        raise CollectionError('INVALID_PUBLIC_DATA', '복지로 공개 안내 구조를 확인할 수 없습니다.') from None
    if not isinstance(detail, dict) or detail.get('wlfareInfoId') != expected_id:
        raise CollectionError('IDENTITY_MISMATCH', '요청한 사업과 공개 안내의 식별자가 다릅니다.')
    # The page also contains internal editor metadata. Never persist those fields or the original HTML.
    service = {key: extract_html(str(detail.get(key) or ''))[0] for key in PUBLIC_FIELDS}
    legal = [{'name': extract_html(str(x.get('wlfareInfoReldNm') or ''))[0], 'content': extract_html(str(x.get('wlfareInfoReldCn') or ''))[0], 'code': '030'} for x in related if isinstance(x, dict) and str(x.get('wlfareInfoDtlCd')) == '030']
    projection = {'service': service, 'legalBases': legal}
    text = '\n\n'.join(label + '\n' + service.get(key, '') for label, key in [('사업명', 'wlfareInfoNm'), ('사업 요약', 'wlfareInfoOutlCn'), ('지원대상', 'wlfareSprtTrgtCn'), ('선정기준', 'wlfareSprtTrgtSlcrCn'), ('지원내용', 'wlfareSprtBnftCn'), ('신청방법', 'aplyMtdDc'), ('페이지 수정일', 'lastChgPtm')])
    text += '\n\n근거법령\n' + '\n'.join(x['name'] + ' ' + x['content'] for x in legal)
    if not service.get('wlfareInfoNm') or not any(service.get(x) for x in ('wlfareSprtTrgtCn', 'wlfareSprtBnftCn')):
        raise CollectionError('EMPTY_PUBLIC_DATA', '사업 안내 본문이 부족합니다.')
    return projection, text


def parse_ordinance(html, expected):
    text, fields = extract_html(html)
    if fields.get('ordinSeq') != str(expected['ordinSeq']) or (expected.get('ordinId') and fields.get('ordinId') != str(expected['ordinId'])):
        raise CollectionError('IDENTITY_MISMATCH', '요청한 조례 버전과 원문 식별자가 다릅니다.')
    title = fields.get('ordinNm', '')
    if re.sub(r'\s+', '', title) != re.sub(r'\s+', '', expected['title']) or not re.search(r'제\s*\d+\s*조', text):
        raise CollectionError('MISSING_PROVISIONS', '조례명 또는 실제 조문을 확인할 수 없습니다.')
    effective = re.search(r'\[시행\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.', text)
    anc = fields.get('ancYd', '')
    return {'text': text, 'version': {
        'ordinSeq': fields['ordinSeq'],
        'ordinId': fields.get('ordinId'),
        'promulgatedDate': f'{anc[:4]}-{anc[4:6]}-{anc[6:8]}' if re.fullmatch(r'\d{8}', anc) else None,
        'effectiveDate': f'{effective[1]}-{int(effective[2]):02d}-{int(effective[3]):02d}' if effective else None,
    }}


def parse_law(html, expected):
    text, fields = extract_html(html)
    if any(fields.get(key) != str(expected[key]) for key in ('lsiSeq', 'lsId')) or fields.get('lsNm') != expected['title'] or not re.search(r'제\s*\d+\s*조', text):
        raise CollectionError('IDENTITY_MISMATCH', '상위법 명칭·버전·실제 조문을 확인할 수 없습니다.')
    def date(key):
        try:
            return datetime.strptime(fields.get(key, ''), '%Y%m%d').date().isoformat()
        except ValueError:
            return None
    return {'text': text, 'legalInstrumentId': 'law:' + fields['lsId'], 'historyStatus': 'current-only', 'version': {
        'ordinSeq': None, 'lsiSeq': fields['lsiSeq'], 'lsId': fields['lsId'],
        'promulgatedDate': date('ancYd'), 'effectiveDate': date('efYd'),
    }}


def xml_value(element):
    result = {}
    for child in element:
        value = xml_value(child) if len(child) else (child.text or '').strip()
        if child.tag in result:
            previous = result[child.tag]
            result[child.tag] = previous + [value] if isinstance(previous, list) else [previous, value]
        else:
            result[child.tag] = value
    return result


def parse_welfare_xml(raw):
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise CollectionError('INVALID_XML', '복지 API 응답이 XML 형식이 아닙니다.') from None
    if root.findtext('.//resultCode') not in ('0', '00'):
        raise CollectionError('API_REJECTED', '복지 API가 정상 결과 코드를 반환하지 않았습니다. 인증·승인·허용량을 확인하세요.')
    try:
        total = int(root.findtext('.//totalCount') or '')
    except ValueError:
        raise CollectionError('INVALID_TOTAL', '복지 API 전체 건수를 확인할 수 없습니다.') from None
    rows = [xml_value(x) for x in root.findall('.//servList')]
    if total < 0 or len(rows) > total or any(not x.get('servId') for x in rows):
        raise CollectionError('INCOMPLETE_PAYLOAD', '복지 API 전체 건수 또는 사업 식별자가 유효하지 않습니다.')
    return rows, total


def parse_statistics(raw):
    decoded = None
    for encoding in ('utf-8-sig', 'cp949'):
        try:
            decoded = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            pass
    if decoded is None:
        raise CollectionError('INVALID_ENCODING', '통계 CSV 인코딩을 확인할 수 없습니다.')
    reader = csv.DictReader(io.StringIO(decoded))
    required = ['사업명', '기준년월', '시도', '시군구', '수급권자수', '수급가구수']
    if not reader.fieldnames or not set(required).issubset(reader.fieldnames):
        raise CollectionError('INVALID_STATISTICS', '수급권자 통계 CSV의 필수 항목이 없습니다.')
    rows = list(reader)
    if not rows or any(not re.fullmatch(r'\d+', x.get('수급권자수', '')) for x in rows):
        raise CollectionError('INVALID_STATISTICS', '통계의 집계 행을 확인할 수 없습니다.')
    return {'recordCount': len(rows), 'columns': reader.fieldnames, 'previewRows': rows[:8]}, decoded


def credentials_from(repo):
    keys = {'DATA_GO_KR_KEY', 'LAW_API_OC', 'LAW_OC'}
    values = {k: os.environ[k] for k in keys if os.environ.get(k)}
    path = repo / '.env'
    if path.exists():
        for line in path.read_text().splitlines():
            if '=' not in line or line.strip().startswith('#'):
                continue
            key, value = line.split('=', 1)
            if key.strip() in keys and key.strip() not in values:
                values[key.strip()] = value.strip().strip('"\'')
    return values


def source_record(id, name, kind, homepage, provider='한국사회보장정보원'):
    return {'id': id, 'name': name, 'provider': provider, 'kind': kind, 'homepageUrl': homepage, 'status': 'unconfigured', 'fetchedAt': None, 'lastAttemptAt': None, 'recordCount': 0, 'totalCount': None, 'message': '', 'snapshotIds': []}


def import_caches(repo, store):
    sources, services = [], []
    for kind, files, home in [
        ('local', ['local_list_전국.json', 'local_서울특별시.json'], 'https://www.data.go.kr/data/15108347/openapi.do'),
        ('central', ['central.partial.json', 'central.json'], 'https://www.data.go.kr/data/15090532/openapi.do'),
    ]:
        source = source_record(kind + '-welfare', '지자체 복지서비스' if kind == 'local' else '중앙부처 복지서비스', kind + '_welfare', home)
        unknown = False
        for filename in files:
            path = repo / 'data/cache' / filename
            if not path.exists():
                continue
            raw = path.read_bytes()
            data = json.loads(raw)
            fetched = (data.get('fetched_at') or data.get('saved_at')) if isinstance(data, dict) else None
            unknown = unknown or fetched is None
            rows = data.get('items', []) if isinstance(data, dict) else data
            snapshot = store.save(source['id'], home, raw, raw.decode('utf-8'), 'application/json', fetched_at=fetched)
            source['snapshotIds'].append(snapshot['id'])
            services.extend(normalize_service(x, kind, source['id'], fetched, snapshot['id']) for x in rows if x.get('servId'))
            if fetched and (not source['fetchedAt'] or fetched > source['fetchedAt']):
                source['fetchedAt'] = fetched
        source['recordCount'] = len({x['id'] for x in services if x['kind'] == kind})
        source['status'] = 'cache' if source['recordCount'] else 'unconfigured'
        source['totalCount'] = source['recordCount'] if kind == 'local' and source['recordCount'] else None
        source['message'] = '기존 공개 API 캐시 수입. 최신 API 재조회 전이며 상세 미확보 사업이 포함됩니다.'
        if unknown:
            source['message'] += ' 일부 원래 수집시각은 미상입니다. 중앙 partial 파일의 수집 완전성은 미확인입니다.'
        sources.append(source)
    return sources, merge_services(services)


def collect_welfare(kind, key, store, fetcher, existing, source):
    base, operation = (LOCAL_API, 'LcgvWelfarelist') if kind == 'local' else (CENTRAL_API, 'NationalWelfarelistV001')
    collected, total, first_total = [], None, None
    # Official documented page size; stop on any incomplete/error response, retain prior cache.
    for page in range(1, 101):
        params = {'serviceKey': urllib.parse.unquote(key), 'pageNo': page, 'numOfRows': 100}
        if kind == 'central':
            params.update(callTp='L', srchKeyCode='003')
        url = base + operation + '?' + urllib.parse.urlencode(params)
        raw, mime = fetcher(url)
        rows, total = parse_welfare_xml(raw)
        if first_total is None:
            first_total = total
        elif total != first_total:
            raise CollectionError('TOTAL_CHANGED', '수집 중 복지 API 전체 건수가 바뀌어 기존 자료를 유지합니다.')
        observed = now()
        snapshot = store.save(source['id'], base + operation + '?' + urllib.parse.urlencode({k: v for k, v in params.items() if k != 'serviceKey'}), raw, raw.decode('utf-8'), mime, fetched_at=observed)
        source['snapshotIds'].append(snapshot['id'])
        collected.extend(normalize_service(x, kind, source['id'], observed, snapshot['id']) for x in rows if x.get('servId'))
        distinct_count = len({x['id'] for x in collected})
        if distinct_count > total or distinct_count != len(collected):
            raise CollectionError('INCOMPLETE_PAYLOAD', '복지 API 페이지의 중복·누적 건수가 전체 건수와 맞지 않습니다.')
        if distinct_count == total:
            source.update(status='live', fetchedAt=observed, totalCount=total, recordCount=len({x['id'] for x in collected}), message='실제 API 목록을 수집했습니다. 상세는 확보된 캐시 범위이며 전 사업 상세 수집을 뜻하지 않습니다.')
            active_ids = {x['id'] for x in collected}
            return merge_services([x for x in existing if x['kind'] != kind or x['id'] in active_ids] + collected)
        if not rows:
            break
        time.sleep(.25)
    raise CollectionError('INCOMPLETE_PAGINATION', '복지 API 목록 페이지가 불완전해 기존 자료를 유지합니다.')


def download_statistics(config, fetcher):
    post = urllib.parse.urlencode({'publicDataPk': config['publicDataPk'], 'publicDataDetailPk': config['publicDataDetailPk'], 'atchFileId': '', 'fileDetailSn': '1', 'publicDataTyCode': 'PR0051'}).encode()
    raw, _ = fetcher('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do', data=post)
    try:
        result = json.loads(raw)
        file_id = result['atchFileId']
        serial = str(result['fileDetailSn'])
        if result.get('status') is not True or not re.fullmatch(r'FILE_\d+', file_id) or not serial.isdigit():
            raise ValueError
        limit_raw, _ = fetcher('https://www.data.go.kr/cmm/cmm/check-limit.json', data=urllib.parse.urlencode({'atchFileId': file_id, 'fileDetailSn': serial}).encode())
        limit = json.loads(limit_raw)
    except (ValueError, KeyError, TypeError):
        raise CollectionError('DOWNLOAD_NOT_AVAILABLE', '공공데이터포털의 공개 파일 다운로드 응답을 확인하지 못했습니다.') from None
    if limit.get('needCaptcha') is not False:
        raise CollectionError('CAPTCHA_REQUIRED', '공공데이터포털이 사람 확인을 요구해 자동 다운로드를 중단했습니다.')
    url = 'https://www.data.go.kr/cmm/cmm/fileDownload.do?' + urllib.parse.urlencode({'atchFileId': file_id, 'fileDetailSn': serial, 'dataNm': config['downloadName']})
    raw, mime = fetcher(url)
    return raw, mime, url


def collect(repo: Path, output: Path, manifest_path: Path, *, online=True, fetcher=fetch_public, credentials=None):
    store = SnapshotStore(output)
    manifest = json.loads(manifest_path.read_text())
    previous = store.load_catalog()
    credentials = credentials_from(repo) if credentials is None else credentials
    sources, services = import_caches(repo, store)
    services = merge_services(services + previous.get('services', []))
    documents, statistics = [], []
    by_source = {x['id']: x for x in sources}
    previous_sources = {x['id']: x for x in previous.get('sources', [])}
    for source in sources:
        prior = previous_sources.get(source['id'], {})
        source['recordCount'] = sum(x['sourceId'] == source['id'] for x in services)
        if source['recordCount']:
            source['status'] = 'cache'
            dates = [x.get('fetchedAt') for x in services if x['sourceId'] == source['id'] and x.get('fetchedAt')]
            source['fetchedAt'] = max(dates, default=None)
        source['snapshotIds'] = list(dict.fromkeys(source['snapshotIds'] + prior.get('snapshotIds', [])))
        if prior.get('totalCount') is not None:
            source['totalCount'] = prior['totalCount']
    for kind in ('local', 'central'):
        source = by_source[kind + '-welfare']
        if not credentials.get('DATA_GO_KR_KEY'):
            source['message'] += ' DATA_GO_KR_KEY 미설정으로 최신 API 수집은 실행하지 않았습니다.'
        elif online:
            source['lastAttemptAt'] = now()
            try:
                services = collect_welfare(kind, credentials['DATA_GO_KR_KEY'], store, fetcher, services, source)
            except CollectionError as error:
                source['status'] = 'partial' if source['recordCount'] else 'blocked'
                source['message'] = str(error) + ' 기존 캐시는 기준일과 함께 유지합니다.'
        source['detailCount'] = sum(x['kind'] == kind and x['detailStatus'] == 'collected' for x in services)
    for settings in manifest.get('sources', []):
        source = source_record(settings['id'], settings['name'], settings['kind'], settings['homepageUrl'], settings['provider'])
        source['message'] = settings.get('message', '')
        sources.append(source)
        by_source[source['id']] = source
    failures = {x['id']: [] for x in sources}
    fresh_counts = {x['id']: 0 for x in sources}
    histories, history_snapshots = {}, {}
    if online:
        for config in manifest.get('histories', []):
            source = by_source[config['sourceId']]
            try:
                raw, mime = fetcher(config['sourceUrl'])
                html = raw.decode('utf-8')
                versions = re.findall(r"ordinViewOrdinHst\('([0-9]+)'", html)
                if not versions:
                    raise CollectionError('EMPTY_HISTORY', '공개 연혁에서 법규 버전을 찾지 못했습니다.')
                timestamp = now()
                snap = store.save(source['id'], config['sourceUrl'], raw, extract_html(html)[0], mime, fetched_at=timestamp)
                histories[config['ordinId']] = versions
                history_snapshots[config['ordinId']] = snap['id']
                source['snapshotIds'].append(snap['id'])
            except CollectionError as error:
                failures[source['id']].append(str(error))
        for config in manifest.get('documents', []):
            source = by_source[config['sourceId']]
            source['lastAttemptAt'] = now()
            try:
                raw, mime = fetcher(config['sourceUrl'])
                html = raw.decode('utf-8')
                document = {key: config[key] for key in ('id', 'kind', 'title', 'jurisdiction', 'sourceUrl', 'relatedServiceIds') if key in config}
                document.update(relationStatus='candidate', historyStatus='missing', version={})
                if config['kind'] == 'ordinance':
                    parsed = parse_ordinance(html, config)
                    document.update(parsed)
                    document['legalInstrumentId'] = 'ordin:' + document['version']['ordinId']
                    history = histories.get(str(config.get('ordinId')), [])
                    document['historyStatus'] = 'current-only' if history and str(config['ordinSeq']) == history[0] else 'missing'
                elif config['kind'] == 'law':
                    document.update(parse_law(html, config))
                elif config.get('parser') == 'bokjiro':
                    projection, text = parse_bokjiro(html, config['serviceId'])
                    # Hash the received page but retain only its public-field projection.
                    document['responseSha256'] = hashlib.sha256(raw).hexdigest()
                    raw = json.dumps(projection, ensure_ascii=False, sort_keys=True).encode()
                    mime = 'application/json'
                    document.update(text=text, representation='public-field-projection')
                else:
                    text, _ = extract_html(html)
                    if len(text) < 100 or config.get('expectedText', config['title']) not in text:
                        raise CollectionError('MISSING_PUBLIC_TEXT', '공개 안내문 제목·본문을 확인하지 못했습니다.')
                    document['text'] = text
                timestamp = now()
                snapshot = store.save(source['id'], config['sourceUrl'], raw, document['text'], mime, fetched_at=timestamp)
                document.update(sourceId=source['id'], snapshotId=snapshot['id'], fetchedAt=timestamp)
                source['snapshotIds'].append(snapshot['id'])
                source['fetchedAt'] = timestamp
                documents.append(document)
                fresh_counts[source['id']] += 1
            except (CollectionError, UnicodeDecodeError) as error:
                failures[source['id']].append(str(error) if isinstance(error, CollectionError) else '공개 문서 인코딩을 확인하지 못했습니다.')
        # A pair is exposed only when the public history and both actual versions exist.
        for ordin_id, history in histories.items():
            matches = [x for x in documents if x['kind'] == 'ordinance' and x['version'].get('ordinId') == ordin_id]
            present = {x['version']['ordinSeq'] for x in matches}
            if len(history) >= 2 and set(history[:2]).issubset(present):
                for doc in matches:
                    if doc['version']['ordinSeq'] in history[:2]:
                        doc['historyStatus'] = 'paired'
                        doc['pairedDocumentIds'] = [x['id'] for x in matches if x['version']['ordinSeq'] in history[:2] and x['id'] != doc['id']]
                        doc['versionRole'] = 'after' if doc['version']['ordinSeq'] == history[0] else 'before'
                        doc['historySnapshotId'] = history_snapshots[ordin_id]
        for config in manifest.get('statistics', []):
            source = by_source[config['sourceId']]
            source['lastAttemptAt'] = now()
            try:
                raw, mime, download_url = download_statistics(config, fetcher)
                item, text = parse_statistics(raw)
                timestamp = now()
                snapshot = store.save(source['id'], download_url, raw, text, mime, fetched_at=timestamp)
                item.update({k: config[k] for k in ('id', 'title', 'provider', 'sourceUrl', 'purpose', 'scope')})
                item.update(sourceId=source['id'], snapshotId=snapshot['id'], fetchedAt=timestamp)
                statistics.append(item)
                fresh_counts[source['id']] += 1
                source['snapshotIds'].append(snapshot['id'])
                source['fetchedAt'] = timestamp
            except CollectionError as error:
                failures[source['id']].append(str(error))
    # A failed refresh never discards previously observed evidence or refreshes its date.
    for key, fresh in [('documents', documents), ('statistics', statistics)]:
        registered = {x['id'] for x in manifest.get(key, [])}
        fresh_ids = {x['id'] for x in fresh}
        for old in previous.get(key, []):
            if old.get('id') not in registered or old['id'] in fresh_ids:
                continue
            try:
                store.read(old['snapshotId'])
            except (OSError, ValueError, KeyError):
                continue
            fresh.append(old)
    for source in sources[2:]:
        entries = [x for x in documents + statistics if x.get('sourceId') == source['id']]
        source['recordCount'] = sum(x.get('recordCount', 1) for x in entries)
        source['totalCount'] = sum(1 for x in manifest.get('documents', []) if x['sourceId'] == source['id']) or None
        if entries:
            source['status'] = 'partial' if failures[source['id']] else 'live' if fresh_counts[source['id']] else 'cache'
            source['fetchedAt'] = max((x['fetchedAt'] for x in entries if x.get('fetchedAt')), default=None)
            source['snapshotIds'] = list(dict.fromkeys(source['snapshotIds'] + [x['snapshotId'] for x in entries]))
        elif failures[source['id']]:
            source['status'] = 'blocked'
        if failures[source['id']]:
            source['message'] += ' 수집 실패: ' + ' / '.join(dict.fromkeys(failures[source['id']]))
        if not online:
            source['message'] += ' 오프라인 실행으로 새 수집을 하지 않았습니다.'
        if source['id'] == 'law-api' and not (credentials.get('LAW_API_OC') or credentials.get('LAW_OC')):
            source['message'] = 'LAW_API_OC 미설정. 전용 인증 API 어댑터는 미연동이며, 실제 법규 수집은 별도 공개 웹 원문·연혁으로 수행합니다.'
        elif source['id'] == 'law-api':
            source['status'] = 'blocked'
            source['message'] = 'OC 설정은 있으나 전용 API 어댑터는 이 수집기에 포함하지 않았습니다. 실제 공개 웹 원문·연혁 수집을 사용합니다.'
    catalog = {'schemaVersion': 1, 'generatedAt': now(), 'sources': sources, 'services': services, 'documents': documents, 'statistics': statistics}
    store.save_catalog(catalog)
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--output', type=Path, default=REPO / 'data/ordinance_impact')
    parser.add_argument('--manifest', type=Path, default=REPO / 'prototype/ordinance_impact/sources.json')
    args = parser.parse_args()
    result = collect(REPO, args.output, args.manifest, online=not args.offline)
    print(json.dumps({'services': len(result['services']), 'documents': len(result['documents']), 'statistics': sum(x['recordCount'] for x in result['statistics']), 'sources': [{'name': x['name'], 'status': x['status'], 'records': x['recordCount']} for x in result['sources']]}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
