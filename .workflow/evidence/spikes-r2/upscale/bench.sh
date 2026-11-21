#!/usr/bin/env bash
# bench.sh <name> <cmd...> — run cmd, record wall seconds + peak RSS KB
set -u
name="$1"; shift
LOG=$(cd "$(dirname "$0")" && pwd)/results/bench.tsv
touch "$LOG"
start=$(date +%s.%N)
/usr/bin/time -v "$@" > $(cd "$(dirname "$0")" && pwd)/work/last_stdout.log 2> $(cd "$(dirname "$0")" && pwd)/work/last_time.log
rc=$?
end=$(date +%s.%N)
wall=$(echo "$end - $start" | bc)
peak=$(grep "Maximum resident" $(cd "$(dirname "$0")" && pwd)/work/last_time.log | awk '{print $6}')
elapsed=$(grep "wall clock" $(cd "$(dirname "$0")" && pwd)/work/last_time.log | sed 's/.*m:ss): //')
echo -e "$name\trc=$rc\twall=${wall}s\tgtime=${elapsed}\tpeakRSS_KB=${peak}" | tee -a "$LOG"
