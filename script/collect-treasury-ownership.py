"""공식 Z.1 CSV와 준비금 PDF를 읽어 보유액 스냅샷을 갱신한다. 의존성: pypdf.

발행량으로 보간하지 않으며, 문서 구조가 달라지면 오류로 중단해 기존 JSON을 보존한다.
테더 신규 보고서는 검증한 원문 URL·기준일·공시일을 설정에 추가한 뒤 실행한다.
"""
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import csv, io, json, re, calendar, zipfile, html, math
from urllib.request import Request, urlopen
from urllib.parse import unquote
from pypdf import PdfReader
from reserve_portfolio import circle_portfolio, tether_portfolio

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'shared/treasury-ownership-config.json').read_text(encoding='utf-8'))
CACHE = ROOT / 'tmp/treasury-ownership'
CACHE.mkdir(parents=True, exist_ok=True)

def fetch(url):
    request = Request(url, headers={'User-Agent': 'ticker-radar data research admin@tritonasia1223.com'})
    with urlopen(request, timeout=60) as response:
        return response.read()

def pdf_text(url, filename):
    dest = CACHE / filename
    if not dest.exists():
        dest.write_bytes(fetch(url))
    text = '\n'.join(page.extract_text() or '' for page in PdfReader(dest).pages)
    dest.with_suffix('.txt').write_text(text, encoding='utf-8')
    return text

def collect_owners():
    archive = zipfile.ZipFile(io.BytesIO(fetch(CONFIG['z1Url'])))
    rows = csv.DictReader(io.StringIO(archive.read('csv/' + CONFIG['table'] + '.csv').decode('utf-8-sig')))
    result = []
    for row in rows:
        year, quarter = map(int, row['date'].split(':Q'))
        if year < CONFIG['startYear']:
            continue
        def value(code):
            n = float(row[code])
            if not math.isfinite(n):
                raise ValueError('국채 잔액 결측: ' + code)
            return n
        month = quarter * 3
        groups = {g['id']: sum(value(s) for s in g['series']) for g in CONFIG['groups']}
        if any(n < 0 for n in groups.values()):
            raise ValueError('통합 보유 주체 잔액 음수: ' + row['date'])
        total = value('FL893061105.Q')
        if abs(sum(groups.values()) - total) > 20:
            raise ValueError('보유 주체 합계 불일치: ' + row['date'])
        result.append({'date': f'{year}-{month:02}-{calendar.monthrange(year, month)[1]}',
                       'total': total, 'outstanding': value('FL313161105.Q'), 'bills': value('FL313161110.Q'),
                       'groups': groups, 'domesticHedgeFunds': value('LM623061103.Q')})
    return result

def circle_report(url):
    decoded = unquote(url)
    month_names = '|'.join(calendar.month_name[1:])
    ym = re.search(r'/([0-9]{4})/.*?(' + month_names + r')', decoded, re.I)
    if not ym:
        raise ValueError('서클 보고서 날짜 인식 실패: ' + url)
    year = int(ym[1]); month = list(calendar.month_name).index(ym[2].capitalize())
    date = f'{year}-{month:02}-{calendar.monthrange(year, month)[1]}'
    text = re.sub(r'\s+', ' ', pdf_text(url, 'circle-' + date + '.pdf'))
    # 월말 표만 추출. 같은 보고서에 있는 월중 표와 합하지 않는다.
    markers = list(re.finditer(r'CIRCLE RESERVE FUND ASSETS AS OF\s+' + calendar.month_name[month] + r'\s+(\d{1,2}),?\s+' + str(year), text, re.I))
    if not markers:
        raise ValueError('서클 월말 표 인식 실패: ' + date)
    marker = max(markers, key=lambda m: int(m[1]))
    date = f'{year}-{month:02}-{int(marker[1]):02}'
    section = text[marker.end():]
    totals = re.findall(r'TOTAL U\.S\. TREASURY SECURITIES\s+\$?\s*([\d,]+)', section)
    if len(totals) not in (1, 2):
        raise ValueError('서클 국채 합계 인식 실패: ' + date)
    numbers = [int(v.replace(',', '')) / 1e6 for v in totals]
    publication = re.findall(r'(' + month_names + r')\s+(\d{1,2}),?\s+(20\d{2})', section, re.I)
    published_at = datetime.strptime(' '.join(publication[-1]), '%B %d %Y').date().isoformat() if publication else None
    return {'issuer': 'circle', 'date': date, 'publishedAt': published_at, 'treasuries': sum(numbers), 'fund': numbers[0],
            'direct': numbers[1] if len(numbers) == 2 else 0, 'source': url, 'frequency': 'monthly',
            'portfolio': circle_portfolio(section, sum(numbers))}

def tether_report(report):
    url = report.get('pdf')
    if not url:
        page = fetch(report['page']).decode()
        links = re.findall(r'href=[\"\x27]([^\"\x27]+\.pdf[^\"\x27]*)', page)
        candidates = [html.unescape(x) for x in links if 'assets.ctfassets.net/' in x or 'tether.io/wp-content/uploads/' in x]
        if len(set(candidates)) != 1:
            raise ValueError('테더 보고서 링크 확인 필요: ' + report['date'])
        url = candidates[0]
    text = re.sub(r'\s+', ' ', pdf_text(url, 'tether-' + report['date'] + '.pdf'))
    amount = re.search(r'U\.?S\.? Treasury Bills\s*[\d¹²³⁴⁵⁶⁷⁸⁹]*\s+([\d]{1,3}(?:,[\d]{3}){2,})', text, re.I)
    if not amount:
        raise ValueError('테더 직접 국채 항목 인식 실패: ' + report['date'])
    return {'issuer': 'tether', 'date': report['date'], 'publishedAt': report['publishedAt'],
            'treasuries': int(amount[1].replace(',', '')) / 1e6,
            'source': url, 'frequency': 'quarterly', 'portfolio': tether_portfolio(text)}

def main():
    # 기존 관측과 출처를 유지한 채 공시 PDF의 추가 항목만 보강한다.
    import sys
    if '--enrich-portfolios' in sys.argv:
        target = ROOT / 'shared/treasury-ownership-data.json'
        data = json.loads(target.read_text(encoding='utf-8'))
        for item in data['issuers']:
            parsed = circle_report(item['source']) if item['issuer'] == 'circle' else tether_report({
                'pdf': item['source'], 'date': item['date'], 'publishedAt': item['publishedAt']})
            if parsed['date'] != item['date'] or abs(parsed['treasuries'] - item['treasuries']) > 0.000001:
                raise ValueError('기존 국채 관측과 불일치: ' + item['date'])
            item['portfolio'] = parsed['portfolio']
        data['portfolioCollectedAt'] = datetime.now(timezone.utc).isoformat()
        temporary = target.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(target)
        print('준비자산 구성 보강 완료:', len(data['issuers']))
        return
    owners = collect_owners()
    circle_page = fetch(CONFIG['circlePage']).decode()
    links = set()
    for link in re.findall(r'href="([^"]+)"', circle_page):
        year = re.search(r'/USDCAttestationReports/(20\d{2})/', link)
        if year and int(year[1]) >= CONFIG['issuerStartYear'] and '.pdf' in link:
            links.add(html.unescape(link))
    if not links:
        raise ValueError('서클 원문 링크 없음')
    with ThreadPoolExecutor(max_workers=4) as pool:
        circle = list(pool.map(circle_report, sorted(links)))
        tether = list(pool.map(tether_report, CONFIG['tetherReports']))
    data = {'collectedAt': datetime.now(timezone.utc).isoformat(), 'unit': 'million_usd',
            'ownershipSource': CONFIG['z1Page'], 'ownershipTable': CONFIG['table'],
            'ownership': owners, 'issuers': sorted(circle + tether, key=lambda x: (x['date'], x['issuer']))}
    target = ROOT / 'shared/treasury-ownership-data.json'
    temporary = target.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)
    print(json.dumps({'ownershipQuarters': len(owners), 'circleMonths': len(circle), 'tetherQuarters': len(tether),
                      'latestOwnership': owners[-1]['date'], 'latestIssuers': data['issuers'][-3:]}, ensure_ascii=False))

if __name__ == '__main__':
    main()
