"""セッションの開始時・会話の圧縮後に、作業前に知るべきことを Claude に見せる。

Claude Code の SessionStart フックから呼ばれる。標準出力がそのまま Claude の文脈に入る。
ネットワークには出ない（本番の状態は scripts/prod-status.sh で別に聞く）。
"""
import io
import os
import re
import socket
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path: str) -> str:
    full = os.path.join(ROOT, path)
    return io.open(full, encoding='utf-8').read() if os.path.exists(full) else ''


def last_work_log() -> str:
    lines = [l for l in read('docs/WORK_LOG.md').split('\n') if re.match(r'^\| (開始|終了) ', l)]
    return lines[-1] if lines else ''


def task_field(name: str) -> str:
    m = re.search(r'^' + name + r'[:：][ 	　]*(.*)$', read('TASK.md'), re.M)
    return m.group(1).strip() if m else ''


def uncommitted() -> int:
    try:
        out = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True, timeout=10).stdout
        return len([l for l in out.decode('utf-8', 'replace').split('\n') if l.strip()])
    except Exception:
        return -1


def main() -> int:
    pc = os.environ.get('PC_NAME') or socket.gethostname()
    log = last_work_log()
    out = ['【作業前の確認（自動）】']
    if log.startswith('| 開始 ') and ('| ' + pc + ' |') not in log:
        out.append('⚠ 他のPCが作業中です。着手せず利用者に確認すること → ' + log)
    else:
        out.append('作業ログの最後: ' + (log or '（記録なし）'))
    state = task_field('状態') or 'なし'
    out.append('TASK.md の状態: ' + state + (' ／ 作業名: ' + task_field('作業名') if task_field('作業名') else ''))
    if state not in ('OK', 'ＯＫ', '省略'):
        out.append('アプリのコードを書き換える前に、kakunin スキルで理解確認をして利用者のOKをもらうこと。')
    count = uncommitted()
    if count > 0:
        out.append(f'未コミットの変更が {count} 件あります。自分の作業か、別のセッションの作業かを確かめてから触ること。')
    # ★本番の状態を確かめるスクリプトがあるプロジェクトだけ案内する（名前はプロジェクトに合わせる）。
    if os.path.exists(os.path.join(ROOT, 'scripts', 'prod-status.sh')):
        out.append('本番の状態を話す前に scripts/prod-status.sh を実行すること。')
    budget = os.path.join(ROOT, 'scripts', 'md-budget.py')
    if os.path.exists(budget):
        try:
            over = subprocess.run([sys.executable, budget, '--brief'], cwd=ROOT, capture_output=True, timeout=10).stdout.decode('utf-8', 'replace').strip()
            if over:
                out.append(over)
        except Exception:
            pass
    sys.stdout.buffer.write(('\n'.join(out) + '\n').encode('utf-8'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
