#!/usr/bin/env bash
# run_model.sh <model> <in> <out> — upscayl-bin 4x on iGPU(-g1), time+RSS
DIR=$(cd "$(dirname "$0")" && pwd); BIN=${UPSCAYL_BIN:-"$DIR/bin/upscayl-bin"}
M=$1; IN=$2; OUT=$3
s=$(date +%s.%N)
/usr/bin/time -v $BIN -i "$IN" -o "$OUT" -m models/all -n "$M" -g 1 >/dev/null 2>work/t.log
rc=$?
e=$(date +%s.%N)
w=$(echo "$e - $s" | bc); p=$(grep "Maximum resident" work/t.log | awk '{print $6}')
echo -e "$M\t$(basename $IN)\trc=$rc\t${w}s\tpeakRSS_KB=$p" | tee -a results/bench2.tsv
