"""他のPC・他のセッションの変更を消すおそれがある git コマンドを止める。

Claude Code の PreToolUse フック（Bash / PowerShell）から呼ばれる。
止めるときは終了コード 2 で理由を標準エラーへ出す。CLAUDE.md「4. 絶対に守ること」を仕組みにしたもの。
"""
import json
import re
import sys

RULES = [
    (re.compile(r'\bgit\b[^|;&]*\breset\b[^|;&]*--hard'), 'git reset --hard'),
    (re.compile(r'\bgit\b[^|;&]*\bpush\b[^|;&]*(\s-f\b|--force)'), 'git push --force'),
    (re.compile(r'\bgit\b[^|;&]*\bclean\b[^|;&]*\s-[a-zA-Z]*f'), 'git clean -f'),
    (re.compile(r'\bgit\b[^|;&]*\b(checkout|restore)\b[^|;&]*\s(--\s+)?\.(\s|$)'), '作業中の変更をまとめて元に戻す git checkout/restore .'),
    (re.compile(r'\bgit\b[^|;&]*\bbranch\b[^|;&]*\s-D\b'), 'git branch -D'),
]


def main() -> int:
    try:
        payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    except Exception:
        return 0
    command = (payload.get('tool_input') or {}).get('command') or ''
    for pattern, name in RULES:
        # git restore --staged . はコミット対象から外すだけで、作業中の変更は消えない。
        if name.startswith('作業中') and re.search(r'\brestore\b', command) and '--staged' in command and '--worktree' not in command:
            continue
        if pattern.search(command):
            sys.stderr.buffer.write((
                '【止めました】' + name + ' は、他のPC・他のセッションの変更を消すおそれがあるため使えません（CLAUDE.md 4章）。\n'
                'どうしても必要なら、理由と消える変更を利用者に説明し、利用者自身に実行してもらうこと。'
            ).encode('utf-8') + b'\n')
            return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
