"""Document model, keyword parser, and offline HTML export."""
from dataclasses import dataclass, field
from html import escape
import re


@dataclass(frozen=True)
class Block:
    kind: str
    text: str = ''
    rows: tuple = field(default_factory=tuple)
    level: int = 0


ALIASES = {'제목': ('heading', 1), '소제목': ('heading', 2), '중제목': ('heading', 2),
           '네모': ('bullet', 1), '원': ('bullet', 2), '동그라미': ('bullet', 2),
           '바': ('bullet', 3), '당구': ('note', 0), '당구장': ('note', 0), '참고': ('note', 0),
           '주석': ('note', 0), '별': ('note', 0), '본문': ('paragraph', 0), '엔터': ('gap', 0)}
TABLE_KEYS = {'표', '시간계획표'}
SAMPLES = {
    '간담회 계획': '제목: 지역주민 간담회 개최 계획\n\n네모: 추진 개요\n일시: 2026. 10. 28.(수) 14:00\n장소: 복지관 2층 강당\n원: 지역주민 30명 및 담당자\n\n네모: 진행 일정\n표: 시간: 내용: 담당\n표: 14시: 개회 및 인사: 사회자\n표: 14시 10분: 주민 의견 나눔: 담당자\n표: 15시: 마무리 및 안내: 사회자\n\n참고: 참석자 명단은 별도로 관리합니다.',
    '업무 보고': '제목: 10월 프로그램 운영 결과\n\n네모: 운영 개요\n원: 대상 — 지역주민 30명\n원: 기간 — 2026. 10. 1. ~ 10. 20.\n\n네모: 주요 실적\n표: 항목: 계획: 실적\n표: 참여 인원: 30: 32\n표: 운영 횟수: 4: 4\n\n네모: 향후 계획\n바: 참여자 의견 반영\n바: 다음 달 일정 안내',
    'Markdown 예제': '# 회의 기록\n\n## 회의 개요\n- 일시: 2026. 10. 20.\n- 장소: 회의실\n\n| 안건 | 담당 | 기한 |\n| --- | --- | --- |\n| 행사 준비 | 사업팀 | 10월 30일 |\n| 안내문 배포 | 운영팀 | 10월 25일 |\n\n일반 문장과 https://example.com 주소도 그대로 보존합니다.',
}


def split_cells(value):
    return [part.replace('\\:', ':').strip() for part in re.split(r'(?<!\\):', value)]


def parse_document(text):
    if len(text) > 300000:
        raise ValueError('문서 입력은 30만 자 이내로 나누어 주세요.')
    blocks, pending = [], []
    def flush():
        if not pending:
            return
        columns = max(map(len, pending))
        if len(pending) > 200 or columns > 20:
            raise ValueError('표 하나는 200행, 20열 이내로 작성해 주세요.')
        normalized = tuple(tuple(row + ['']*(columns-len(row))) for row in pending)
        blocks.append(Block('table', rows=normalized))
        pending.clear()
    for raw in text.replace('\r\n', '\n').replace('\r', '\n').split('\n'):
        line = raw.strip()
        if line.startswith('|') and line.endswith('|'):
            cells = [cell.strip() for cell in line[1:-1].split('|')]
            if all(re.fullmatch(r':?-{3,}:?', cell) for cell in cells):
                continue
            pending.append(cells)
            continue
        head, sep, tail = line.partition(':')
        key = head.strip()
        if sep and key in TABLE_KEYS:
            pending.append(split_cells(tail))
            continue
        flush()
        if not line:
            blocks.append(Block('gap'))
        elif re.match(r'^#{1,3}\s+', line):
            hashes, content = line.split(maxsplit=1)
            blocks.append(Block('heading', content, level=min(len(hashes), 3)))
        elif re.match(r'^[-*]\s+', line):
            blocks.append(Block('bullet', line[2:].strip(), level=2))
        elif sep and key in ALIASES:
            kind, level = ALIASES[key]
            blocks.append(Block(kind, tail.strip(), level=level))
        else:
            blocks.append(Block('paragraph', line))
    flush()
    return blocks


def plain_text(blocks):
    symbols = {1:'□', 2:'○', 3:'-'}
    rows=[]
    for block in blocks:
        if block.kind=='table':
            rows.extend('  |  '.join(row) for row in block.rows)
        elif block.kind=='bullet':
            rows.append(f'{symbols.get(block.level,"-")} {block.text}')
        elif block.kind=='note':
            rows.append('※ '+block.text)
        else:
            rows.append(block.text)
    return '\n'.join(rows)


def to_html(blocks):
    parts=[]
    for block in blocks:
        content=escape(block.text)
        if block.kind=='table':
            rows=['<tr>'+''.join(f'<{"th" if i==0 else "td"}>{escape(v)}</{"th" if i==0 else "td"}>' for v in row)+'</tr>' for i,row in enumerate(block.rows)]
            parts.append('<table>'+''.join(rows)+'</table>')
        elif block.kind=='heading':
            tag=f'h{block.level}'
            parts.append(f'<{tag}>{content}</{tag}>')
        elif block.kind=='bullet':
            parts.append(f'<p class="indent level{block.level}">{ {1:"□",2:"○",3:"-"}.get(block.level,"-") } {content}</p>')
        elif block.kind=='gap':
            parts.append('<div class="gap"></div>')
        elif block.kind=='note':
            parts.append(f'<p class="note">※ {content}</p>')
        else:
            parts.append(f'<p>{content}</p>')
    return '''<!doctype html><html lang="ko"><meta charset="utf-8"><title>범피스 작업실 문서</title>
<style>body{background:#edf2f5;color:#182d38;font:11pt/1.75 "맑은 고딕",sans-serif;margin:0}main{background:white;max-width:170mm;min-height:247mm;padding:20mm;margin:24px auto}h1{font-size:20pt;text-align:center;margin:0 0 24px}h2{font-size:15pt;margin:22px 0 8px}h3{font-size:12pt}p{margin:5px 0;white-space:pre-wrap}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #8d9eaa;padding:7px;text-align:left;white-space:pre-wrap}th{background:#e9f1f5}.level2{padding-left:14px}.level3{padding-left:30px}.note{font-size:10pt;color:#526777}.gap{height:10px}@media print{body{background:white}main{margin:0;padding:0;max-width:none;min-height:0}@page{size:A4;margin:20mm}}</style><main>'''+''.join(parts)+'</main></html>'
