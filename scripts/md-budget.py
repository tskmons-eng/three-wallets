"""指示書と記録ファイルが太りすぎていないか調べる。上限は .claude/md-budget.json（数字を書き換えて調節する）。

使い方:
  python scripts/md-budget.py            一覧を出す（上限を超えたものに印）
  python scripts/md-budget.py --brief    上限を超えたものだけ出す（session-start.py が使う）
  python scripts/md-budget.py --hook     PostToolUse フック用。書いたファイルが上限を超えたら Claude へ知らせる
止めはしない。知らせるだけ。
"""
import fnmatch
import glob
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, '.claude', 'md-budget.json')


def load() -> dict:
    if not os.path.exists(CONFIG):
        return {'groups': [], 'files': []}
    return json.load(io.open(CONFIG, encoding='utf-8'))


def lines(rel: str) -> int:
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return 0
    return len(io.open(path, encoding='utf-8', errors='replace').read().splitlines())


def files_for(pattern: str) -> list:
    found = glob.glob(os.path.join(ROOT, pattern))
    return sorted(os.path.relpath(f, ROOT).replace('\\', '/') for f in found)


def check(config: dict) -> list:
    """(名前, 行数, 上限, どうするか) の一覧を返す。"""
    rows = []
    for rule in config.get('files', []):
        for rel in files_for(rule['pattern']):
            rows.append((rel, lines(rel), int(rule['max_lines']), rule.get('when_over', '')))
    for group in config.get('groups', []):
        total = sum(lines(rel) for rel in group['files'])
        rows.append((group['name'] + '（' + '＋'.join(group['files']) + '）', total, int(group['max_lines']), group.get('when_over', '')))
    return rows


def over_message(rows: list) -> str:
    over = [r for r in rows if r[1] > r[2]]
    if not over:
        return ''
    out = ['【ファイルが太りすぎています（.claude/md-budget.json の上限）】']
    for name, count, limit, todo in over:
        out.append(f'- {name}: {count}行 ／ 上限 {limit}行 → {todo}')
    out.append('今の作業が終わったら、利用者に整理を提案すること（上限を上げるかどうかは利用者が決める）。')
    return '\n'.join(out)


def touched(path: str) -> str:
    full = os.path.normcase(os.path.abspath(path))
    rel = os.path.relpath(full, os.path.normcase(ROOT)).replace('\\', '/')
    return '' if rel.startswith('..') else rel


def main() -> int:
    config = load()
    if '--hook' in sys.argv:
        try:
            payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
        except Exception:
            return 0
        rel = touched((payload.get('tool_input') or {}).get('file_path') or '')
        if not rel:
            return 0
        watched = [r['pattern'] for r in config.get('files', [])] + [f for g in config.get('groups', []) for f in g['files']]
        if not any(fnmatch.fnmatch(rel.lower(), p.lower()) for p in watched):
            return 0
        message = over_message(check(config))
        if message:
            out = {'hookSpecificOutput': {'hookEventName': 'PostToolUse', 'additionalContext': message}}
            sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode('utf-8'))
        return 0
    rows = check(config)
    if '--brief' in sys.argv:
        message = over_message(rows)
        if message:
            sys.stdout.buffer.write((message + '\n').encode('utf-8'))
        return 0
    out = []
    for name, count, limit, _ in rows:
        mark = '★超過' if count > limit else ''
        out.append(f'{count:>6} / {limit:<6} {mark:<4} {name}')
    sys.stdout.buffer.write(('\n'.join(out) + '\n').encode('utf-8'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
