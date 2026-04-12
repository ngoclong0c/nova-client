"""
Nova Client Version Manager
============================
Script chạy 1 lần để cập nhật phiên bản Nova Client.
Cập nhật version.json + versions.json rồi push lên GitHub.
Launcher sẽ đọc version.json từ GitHub raw file để check update.

Cách dùng:
  python version_server.py 0.2.0                      # Cập nhật version
  python version_server.py 0.2.0 --notes "Bug fixes"  # Có release notes
  python version_server.py --list                      # Xem lịch sử version
"""

import os
import sys
import json
import subprocess
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
VERSION_FILE = os.path.join(ROOT_DIR, 'version.json')
HISTORY_FILE = os.path.join(SCRIPT_DIR, 'versions.json')
PACKAGE_FILE = os.path.join(ROOT_DIR, 'package.json')

GITHUB_OWNER = 'ngoclong0c'
GITHUB_REPO = 'nova-client'

UPDATE_FILES = ['main.js', 'preload.js', 'index.html', 'package.json', 'fabric-mod/']


def load_json(filepath):
    if not os.path.exists(filepath):
        return {}
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def compare_versions(a, b):
    pa = [int(x) for x in a.split('.')]
    pb = [int(x) for x in b.split('.')]
    for i in range(max(len(pa), len(pb))):
        na = pa[i] if i < len(pa) else 0
        nb = pb[i] if i < len(pb) else 0
        if na > nb:
            return 1
        if na < nb:
            return -1
    return 0


def get_current_version():
    pkg = load_json(PACKAGE_FILE)
    return pkg.get('version', '0.0.0')


def list_versions():
    """Xem danh sách tất cả phiên bản."""
    history = load_json(HISTORY_FILE)
    versions = history.get('versions', [])

    if not versions:
        print('Chua co phien ban nao.')
        return

    current = get_current_version()
    print(f'\n  Nova Client - Lich su phien ban')
    print(f'  Phien ban hien tai: {current}')
    print(f'  {"=" * 50}')

    for v in versions:
        marker = ' <-- hien tai' if v['version'] == current else ''
        print(f'  v{v["version"]}{marker}')
        print(f'    Notes: {v.get("release_notes", "")}')
        print(f'    Date:  {v.get("release_date", "N/A")}')
        print(f'    URL:   {v.get("download_url", "N/A")}')
        print()


def update_version(version, release_notes=None):
    """Cập nhật version mới → ghi file → push lên GitHub."""

    current = get_current_version()
    download_url = f'https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/download/v{version}/nova-client-{version}.zip'
    now = datetime.now(timezone.utc).isoformat()

    if not release_notes:
        release_notes = f'Nova Client v{version}'

    print(f'\n  Cap nhat phien ban: {current} -> {version}')
    print(f'  Release notes: {release_notes}')
    print()

    # 1. Cập nhật package.json
    pkg = load_json(PACKAGE_FILE)
    pkg['version'] = version
    save_json(PACKAGE_FILE, pkg)
    print(f'  [OK] package.json -> v{version}')

    # 2. Cập nhật version.json (launcher đọc file này)
    version_data = {
        'latest_version': version,
        'download_url': download_url,
        'release_notes': release_notes,
        'release_date': now,
        'min_version': '0.1.0',
        'files': UPDATE_FILES
    }
    save_json(VERSION_FILE, version_data)
    print(f'  [OK] version.json -> v{version}')

    # 3. Cập nhật lịch sử versions.json
    history = load_json(HISTORY_FILE)
    if 'versions' not in history:
        history['versions'] = []

    new_entry = {
        'version': version,
        'download_url': download_url,
        'release_notes': release_notes,
        'release_date': now,
        'min_version': '0.1.0',
        'files': UPDATE_FILES
    }

    # Xóa version cũ nếu trùng
    history['versions'] = [v for v in history['versions'] if v['version'] != version]
    history['versions'].insert(0, new_entry)

    # Sắp xếp mới nhất trước
    history['versions'].sort(
        key=lambda v: [int(x) for x in v['version'].split('.')],
        reverse=True
    )
    history['latest_version'] = history['versions'][0]['version']
    save_json(HISTORY_FILE, history)
    print(f'  [OK] versions.json -> {len(history["versions"])} phien ban')

    # 4. Git commit + tag + push
    print()
    print('  Dang push len GitHub...')
    try:
        subprocess.run(['git', 'add', 'package.json', 'version.json', 'server/versions.json'],
                       cwd=ROOT_DIR, check=True, capture_output=True)
        subprocess.run(['git', 'add', '-u'], cwd=ROOT_DIR, check=True, capture_output=True)
        subprocess.run(['git', 'commit', '-m', f'release: v{version}'],
                       cwd=ROOT_DIR, check=True, capture_output=True)
        subprocess.run(['git', 'tag', f'v{version}'],
                       cwd=ROOT_DIR, check=True, capture_output=True)
        subprocess.run(['git', 'push', 'origin', 'main', '--tags'],
                       cwd=ROOT_DIR, check=True, capture_output=True)
        print(f'  [OK] Pushed tag v{version} len GitHub')
        print(f'  [OK] GitHub Actions se tu dong tao release ZIP')
        print(f'\n  Check: https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/actions')
    except subprocess.CalledProcessError as e:
        print(f'  [LOI] Git push that bai: {e.stderr.decode() if e.stderr else e}')
        print('  Ban co the push thu cong:')
        print(f'    git add -A && git commit -m "release: v{version}"')
        print(f'    git tag v{version} && git push origin main --tags')

    print(f'\n  Launcher se doc version.json tu:')
    print(f'  https://raw.githubusercontent.com/{GITHUB_OWNER}/{GITHUB_REPO}/main/version.json')
    print()


def main():
    args = sys.argv[1:]

    if not args:
        print(__doc__)
        return

    if '--list' in args or '-l' in args:
        list_versions()
        return

    version = args[0]

    # Validate version format
    parts = version.split('.')
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        print(f'  [LOI] Version phai co dang x.y.z (vd: 0.2.0), nhan duoc: {version}')
        sys.exit(1)

    # Parse --notes
    release_notes = None
    if '--notes' in args:
        idx = args.index('--notes')
        if idx + 1 < len(args):
            release_notes = args[idx + 1]

    update_version(version, release_notes)


if __name__ == '__main__':
    main()
