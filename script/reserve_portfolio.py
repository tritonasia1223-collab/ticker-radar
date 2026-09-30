"""준비자산 공시 표를 파싱한다. 금액 단위는 보유액 자료와 같은 백만 달러다."""
import re

AMOUNT = r'([\d]{1,3}(?:,[\d]{3}){2,})'


def amount_after(text, label, optional=False):
    found = re.search(label + r'\s*[\d¹²³⁴⁵⁶⁷⁸⁹]*\s+\$?\s*' + AMOUNT, text, re.I)
    if not found:
        if optional:
            return 0
        raise ValueError('준비자산 항목 인식 실패: ' + label)
    return int(found[1].replace(',', '')) / 1e6


def validate(total, components):
    if total <= 0 or any(v < 0 for v in components.values()):
        raise ValueError('준비자산 금액 범위 오류')
    if abs(total - sum(components.values())) > 0.00002:
        raise ValueError('준비자산 합계 불일치: ' + str(total - sum(components.values())))
    return {'total': total, 'components': components}


def circle_portfolio(section, treasuries):
    # 전달받은 월말 구간만 사용한다. 월중 관측을 합산하지 않는다.
    total = amount_after(section, r'TOTAL USDC RESERVE ASSETS AS OF [A-Z]+\s+\d{1,2},?\s+20\d{2}')
    repos = re.findall(r'U\.S\. Treasury Repurchase Agreements\s*[\d¹²³⁴⁵⁶⁷⁸⁹]*\s+\$?\s*' + AMOUNT, section, re.I)
    if not repos or 'Cash held' not in section:
        raise ValueError('서클 역레포·현금 항목 확인 필요')
    repo = sum(int(v.replace(',', '')) / 1e6 for v in repos)
    # 공시 현금 및 미수·미지급 정산 순액을 함께 표시한다.
    return validate(total, {'treasuries': treasuries, 'overnight_repo': repo,
                            'cash_net': total - treasuries - repo})


def tether_portfolio(text):
    table = text[text.index('Asset Category'):]
    total_match = re.search(r'Total(?: Assets)?\s*\([\d+]+\)\s*' + AMOUNT, table)
    if not total_match:
        raise ValueError('테더 준비자산 총액 인식 실패')
    table = table[:total_match.end()]
    total = int(total_match[1].replace(',', '')) / 1e6
    components = {key: amount_after(table, label, optional) for key, label, optional in [
        ('treasuries', r'U\.?S\.? Treasury Bills', False),
        ('overnight_repo', 'Overnight Reverse Repurchase Agreements', False),
        ('term_repo', 'Term Reverse Repurchase Agreements', False),
        ('mmf', 'Money Market Funds', True),
        ('cash', 'Cash & Bank Deposits', False),
        ('metals', 'Precious Metals', False),
        ('bitcoin', 'Bitcoin', False),
        ('loans', 'Secured Loans', False),
    ]}
    # 세부 항목도 실제 공시에서 읽어 합계 검증한다. 잔여액을 임의로 채우지 않는다.
    components['other'] = sum(amount_after(table, label, optional) for label, optional in [
        ('Corporate Bonds', False), ('Other Investments', False),
        ('Public Equities', True), (r'Non-U\.?S\.? Treasury Bills', True)])
    return validate(total, components)
