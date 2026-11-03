#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicit prerequisites: install locked tooling with npm ci --ignore-scripts,
# Playwright Chromium with npx playwright install chromium, and the lychee CLI.
command -v lychee >/dev/null || { echo 'Install lychee before the complete local gate.' >&2; exit 1; }
export CI=1
npm test
npm audit --audit-level=low
npm run test:browser
link_inputs=()
while IFS= read -r -d '' input; do link_inputs+=("$input"); done < <(git ls-files -z -- '*.md' '*.html' assets/links.json)
lychee --verbose --no-progress --root-dir "$PWD" --index-files index.html \
  --remap "^https://links\\.seeknay\\.com/ file://$PWD/" \
  --exclude '(localhost|127\.0\.0\.1):' --exclude 'googletagmanager.com' \
  --exclude '^https://www\.instagram\.com/seeknay747/?$' \
  "${link_inputs[@]}"
