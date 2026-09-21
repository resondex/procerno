#!/bin/zsh
# Fireworks LoRA fine-tune launch for the Procerno judgment coder.
#
# MUST BE RUN BY HAND. firectl refuses every mutating command (create dataset,
# create sftj) when it detects an AI agent, --dry-run included, so Claude
# cannot run this. Everything after the job is created - polling, LoRA load,
# eval, scoring - is read-only or plain HTTP and needs no human hands.
#
# Usage: ./fireworks_launch.sh [base-model]
set -e
cd "$(dirname "$0")"

# Base model choice: the original default (llama-v3p1-8b-instruct) is past its
# 2025-11-26 deprecation date and reports an INTERNAL error; the alternate
# (qwen2p5-7b-instruct) is tunable but absent from the serverless catalog, so
# serving a LoRA on it would need a dedicated GPU deployment. muse-glimmer-30b
# is the smallest model that is serverless AND "Supervised Lora Tunable",
# so the addon serves with no deployment to stand up or tear down.
BASE="${1:-accounts/fireworks/models/muse-glimmer-30b}"
OUT="procerno-coder-v1"

# Fireworks resource IDs may reject underscores; try the preferred underscore
# name first and fall back to hyphens, then reuse whichever took.
mk_dataset() {
  local want="$1" file="$2" alt="${1//_/-}"
  if firectl create dataset "$want" "$file" >/dev/null 2>&1; then echo "$want"; return; fi
  if firectl get dataset "$want" >/dev/null 2>&1; then echo "$want"; return; fi
  if firectl create dataset "$alt" "$file" >/dev/null 2>&1; then echo "$alt"; return; fi
  if firectl get dataset "$alt" >/dev/null 2>&1; then echo "$alt"; return; fi
  echo "FAILED to create dataset $want" >&2; exit 1
}

echo "== uploading datasets (5,081 train / 300 val) =="
TRAIN_DS=$(mk_dataset procerno_coder_jira_v1 train.jsonl)
VAL_DS=$(mk_dataset procerno_coder_jira_v1_val val.jsonl)
echo "   train: $TRAIN_DS"
echo "   val:   $VAL_DS"

# max-context-length 8192: longest training example is ~4.6K tokens, so 8192 is
# ample headroom. Leaving it unset would pin the job to the shape's full 131K
# context and cost far more for no benefit.
echo "== creating supervised fine-tuning job on $BASE =="
firectl create sftj \
  --base-model "$BASE" \
  --dataset "$TRAIN_DS" \
  --evaluation-dataset "$VAL_DS" \
  --output-model "$OUT" \
  --display-name "procerno jira coder v1" \
  --epochs 2 \
  --lora-rank 16 \
  --lora-alpha 32 \
  --learning-rate 0.0001 \
  --learning-rate-scheduler cosine \
  --learning-rate-warmup-steps 20 \
  --max-context-length 8192

echo
echo "== job created. Poll with: firectl list sftj   /   firectl get sftj <id> =="
echo "   Then hand the job id back to Claude for polling, LoRA load and eval."
