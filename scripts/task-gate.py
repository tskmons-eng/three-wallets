"""理解確認（TASK.md）が済んでいない間、アプリのコードの書き換えを止める。

Claude Code の PreToolUse フックから呼ばれる。標準入力にツールの入力が JSON で来る。
止めるときは終了コード 2 で理由を標準エラーへ出す（Claude に伝わる）。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASK = os.path.join(ROOT, 'TASK.md')
# ★プロジェクトに合わせて直す：アプリのコードがあるフォルダ（プロジェクト直下からの1段目の名前）。
# 技術の構成が決まるまでは、よく使われる置き場所をまとめて止める。決まったら絞る。docs や tests は入れない。
GATED = ('src', 'app', 'pages', 'components', 'lib', 'public', 'server', 'api', 'prisma', 'db', 'styles')
DIRS = '|'.join(GATED)

# Bash / PowerShell で直接ファイルを書き換える書き方（読むだけのコマンドは止めない）
WRITE_PATTERNS = [
    re.compile(r'\b(sed|perl)\b[^|;&]*\s-i[^|;&]*\b(' + DIRS + r')[\\/]'),
    re.compile(r'>\s*["\']?(\./)?(' + DIRS + r')[\\/]'),
    re.compile(r'\btee\b[^|;&]*\b(' + DIRS + r')[\\/]'),
    re.compile(r'\b(Set-Content|Add-Content|Out-File)\b[^|;]*\b(' + DIRS + r')[\\/]', re.I),
]


def task_status(task: str = TASK) -> str:
    if not os.path.exists(task):
        return 'なし'
    for line in io.open(task, encoding='utf-8').read().split('\n'):
        m = re.match(r'^状態[:：]\s*(\S*)', line.strip())
        if m:
            return m.group(1)
    return 'なし'


def is_open(task: str = TASK) -> bool:
    return task_status(task).upper().replace('ＯＫ', 'OK') in ('OK', '省略')


def gated_task(path: str) -> str:
    """止める対象のファイルなら、それを判定する TASK.md の場所を返す。対象外なら空文字。

    worktree（.claude/worktrees/<名前>/）の中のファイルは、その worktree の TASK.md で判定する。
    CLAUDE_PROJECT_DIR は worktree へ移っても元のフォルダを指したままなので、ここで振り分ける。
    """
    # Git Bash の書き方（/c/Users/...）も Windows の書き方（C:/Users/...）に直してから比べる。
    m = re.match(r'^/([a-zA-Z])/(.*)$', path)
    if m and os.name == 'nt':
        path = m.group(1) + ':/' + m.group(2)
    full = os.path.normcase(os.path.abspath(path if os.path.isabs(path) else os.path.join(ROOT, path)))
    rel = os.path.relpath(full, os.path.normcase(ROOT))
    if rel.startswith('..'):
        return ''
    parts = rel.replace('\\', '/').split('/')
    root = ROOT
    if parts[:2] == ['.claude', 'worktrees'] and len(parts) > 3:
        root = os.path.join(ROOT, '.claude', 'worktrees', parts[2])
        parts = parts[3:]
    return os.path.join(root, 'TASK.md') if parts[0] in GATED else ''


def blocked(payload: dict) -> tuple:
    """(止める理由, 判定に使う TASK.md) を返す。止めないなら理由は空文字。"""
    tool = payload.get('tool_name') or ''
    data = payload.get('tool_input') or {}
    if tool in ('Bash', 'PowerShell'):
        command = data.get('command') or ''
        if any(p.search(command) for p in WRITE_PATTERNS):
            return 'コマンドでアプリのコードを書き換えようとしています', TASK
        return '', TASK
    path = data.get('file_path') or data.get('notebook_path') or ''
    task = gated_task(path) if path else ''
    if task:
        return os.path.basename(path) + ' を書き換えようとしています', task
    return '', TASK


def message(reason: str, task: str = TASK) -> str:
    return (
        '【理解確認が済んでいません】' + reason + '。\n'
        + os.path.relpath(task, ROOT) + ' の状態が「' + task_status(task) + '」です。実装の前に kakunin スキルの手順で\n'
        '目的・使われ方・影響・要る/要らない機能を TASK.md に書き、利用者のOKをもらってください。\n'
        '利用者が言っていないのに状態を OK にしてはいけません。'
    )


def main() -> int:
    if '--check' in sys.argv:
        if is_open():
            return 0
        sys.stderr.buffer.write(message('Codex に実装を渡そうとしています').encode('utf-8') + b'\n')
        return 2
    try:
        payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    except Exception:
        return 0
    reason, task = blocked(payload)
    if not reason or is_open(task):
        return 0
    sys.stderr.buffer.write(message(reason, task).encode('utf-8') + b'\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())
