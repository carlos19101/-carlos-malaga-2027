#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "[CARLOS] Naprawa parseClock..."
python3 - <<'PY'
from pathlib import Path
p = Path('src/parse.js')
s = p.read_text()
old = "return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60 + p[1] + p[2] / 60;"
new = "return p.length === 2 ? p[0] + p[1] / 60 : p[0] * 60 + p[1] + p[2] / 60;"
if old in s:
    p.write_text(s.replace(old, new, 1))
elif new not in s:
    raise SystemExit('ERROR: nie znaleziono oczekiwanej funkcji parseClock')
PY

printf '%s\n' 'node_modules/' 'dist/' '.DS_Store' > .gitignore

echo "[CARLOS] Testy..."
npm test

echo "[CARLOS] Build..."
npm run build

git diff --check
rm -rf dist
rm -f CARLOS-FINAL-apply.sh x.sh

git add .gitignore package.json index.html public/manifest.webmanifest public/sw.js \
  src/main.jsx src/styles.css src/parse.js src/parse.test.js \
  src/performance.js src/performance.test.js vite.config.js

git commit -m "CARLOS FINAL: complete performance dashboard"
git push origin main

echo
echo "===================================="
echo " CARLOS FINAL: 21/21 + BUILD + PUSH"
echo "===================================="
git --no-pager log -1 --oneline
