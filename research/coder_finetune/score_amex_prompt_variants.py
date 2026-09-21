"""Paired comparison of prompt variants for the jira-trained coder on AmEx.

All variants run over the SAME fixed 800-row sample; the baseline column is
subset from the full ft_amex_eval.jsonl run (same model, same temperature 0,
so re-running it would be redundant).

Variants:
  baseline - bare code list, original system prompt
  defs     - each code given a one-line definition, "use the most specific"
  count    - system prompt told to list every attribute argued from
  both     - defs + count

Usage: python3 score_amex_prompt_variants.py
"""
import ast
import json
import os
from collections import Counter

EV = os.path.expanduser("~/Documents/procerno_eval")
F = f"{EV}/finetune"
sample = set(json.load(open(f"{F}/amex_prompt_sample.json")))
truth = {
    json.loads(l)["id"]: json.loads(l)
    for l in open(f"{EV}/amex/opus_full_amex.jsonl")
    if l.strip()
}
norm = lambda s: (s or "").strip().lower()


def reasons_of(r):
    v = r.get("reasons") or []
    if isinstance(v, str):
        try:
            v = ast.literal_eval(v)
        except Exception:
            v = []
    return set(map(norm, v or []))


def top_pick_of(r):
    v = r.get("top_pick")
    return "" if v in (None, "None", "none", "") else norm(v)


def load(path):
    d = {}
    for l in open(path):
        if l.strip():
            r = json.loads(l)
            if r["responseId"] in sample:
                d[r["responseId"]] = r
    return d


runs = {"baseline": load(f"{F}/ft_amex_eval.jsonl")}
for v in ("defs", "count", "both"):
    p = f"{F}/ft_amex_{v}.jsonl"
    if os.path.exists(p):
        runs[v] = load(p)


def score(pred):
    c = Counter()
    for rid in sample:
        L, C = truth.get(rid), pred.get(rid)
        if not L or not C:
            continue
        c["n"] += 1
        c["outcome"] += norm(C.get("outcome")) == norm(L.get("outcome"))
        c["framing"] += norm(C.get("target_framing")) == norm(L.get("target_framing"))
        c["top_pick"] += top_pick_of(C) == top_pick_of(L)
        t, p = reasons_of(L), reasons_of(C)
        hit = len(t & p)
        c["rp_n"] += hit
        c["rp_d"] += len(p)
        c["rr_n"] += hit
        c["rr_d"] += len(t)
        c["emitted"] += len(p)
        c["true_codes"] += len(t)
        if "rewards rate" in p and "rewards rate" not in t:
            c["rr_fp"] += 1
    return c


pct = lambda a, b: f"{100*a/b:.1f}%" if b else "n/a"
print(f"paired comparison on {len(sample)} AmEx rows (jira-trained adapter, temp 0)\n")
hdr = (f"{'variant':<10} {'n':>4}  {'outcome':>8} {'framing':>8} {'top_pick':>8} "
       f"{'reasonP':>8} {'reasonR':>8}  {'codes/row':>9} {'rwdFP':>6}")
print(hdr)
base = None
for name in ("baseline", "defs", "count", "both"):
    if name not in runs:
        continue
    c = score(runs[name])
    if base is None:
        base = c
    print(f"{name:<10} {c['n']:>4}  {pct(c['outcome'],c['n']):>8} {pct(c['framing'],c['n']):>8} "
          f"{pct(c['top_pick'],c['n']):>8} {pct(c['rp_n'],c['rp_d']):>8} {pct(c['rr_n'],c['rr_d']):>8}  "
          f"{c['emitted']/c['n']:>9.2f} {c['rr_fp']:>6}")
if base:
    print(f"{'(truth)':<10} {base['n']:>4}  {'-':>8} {'-':>8} {'-':>8} {'-':>8} {'-':>8}  "
          f"{base['true_codes']/base['n']:>9.2f} {'-':>6}")

print("\ndeltas vs baseline (percentage points):")
b = score(runs["baseline"])
for name in ("defs", "count", "both"):
    if name not in runs:
        continue
    c = score(runs[name])
    d = lambda k, n_, d_: 100 * c[k] / c[d_] - 100 * b[k] / b[d_] if c[d_] and b[d_] else 0
    print(f"  {name:<6} outcome {d('outcome','','n'):+5.1f}  framing {d('framing','','n'):+5.1f}  "
          f"top_pick {d('top_pick','','n'):+5.1f}  reasonP {d('rp_n','','rp_d'):+5.1f}  "
          f"reasonR {d('rr_n','','rr_d'):+5.1f}")
