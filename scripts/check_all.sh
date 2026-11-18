#!/bin/bash
# Run the full round of dashboard checks side by side on the test copy (data/dashboard_fixture.db - a snapshot of
# live, no model keys, nothing written to live). Each check is its own process and only reads the copy, so the
# round takes as long as its slowest check instead of the sum.
#
#   scripts/check_all.sh            run every check
#   scripts/check_all.sh links map  run only the named ones
#
# Prints one line per check (PASS / FAIL and seconds) and leaves each check's full output in $OUT.
cd "$(dirname "$0")/.." || exit 1
OUT="${OUT:-${TMPDIR:-/tmp}/procerno_checks}"
mkdir -p "$OUT"

names=(types registry links citation panels map fixture serve facts statements data)
cmd_types="npx tsc --noEmit -p ."
cmd_registry="npx tsx scripts/stat_registry_harness.mts"
cmd_links="npx tsx scripts/brief_links_harness.mts"
cmd_citation="npx tsx scripts/brief_citation_harness.mts"
cmd_panels="npx tsx scripts/panel_synthetic_test.mts"
cmd_map="npx tsx scripts/analysis_map_harness.mts"
cmd_fixture="npx tsx scripts/checker_fixture.mts"
cmd_facts="npx tsx scripts/fact_layer_harness.mts"
cmd_statements="npx tsx scripts/statements_harness.mts"
cmd_data="npx tsx scripts/data_page_harness.mts"
# serve_logic_harness builds its own temporary store: SQLITE_PATH must not be set for it.
cmd_serve="env -u SQLITE_PATH npx tsx scripts/serve_logic_harness.mts"

[ $# -gt 0 ] && names=("$@")
pids=()
for n in "${names[@]}"; do
  c="cmd_$n"
  if [ -z "${!c}" ]; then echo "unknown check: $n"; exit 2; fi
  ( s=$SECONDS; bash -c "${!c}" > "$OUT/$n.txt" 2>&1; echo "$? $((SECONDS - s))" > "$OUT/$n.rc" ) &
  pids+=($!)
done
wait "${pids[@]}"

fail=0
for n in "${names[@]}"; do
  read -r rc secs < "$OUT/$n.rc"
  if [ "$rc" = "0" ]; then printf "PASS  %-9s %4ss\n" "$n" "$secs"
  else printf "FAIL  %-9s %4ss   %s\n" "$n" "$secs" "$(grep -m1 -E 'FAIL|error|Error' "$OUT/$n.txt" | cut -c1-160)"; fail=1; fi
done
echo "full output: $OUT"
exit $fail
