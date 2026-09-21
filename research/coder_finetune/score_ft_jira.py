"""Score the Fireworks fine-tuned judgment coder (muse-glimmer-30b LoRA,
deployment-scoped addon) over the 5,720 jira answers. Exact accuracy, no
projection. The fine-tune emits target_framing and top_pick directly, so there
is no mentions join.

Two things this script is careful about:

1. CONTAMINATION. The 5,720 rows are 5,081 trained-on + 300 val + 339 ratified.
   Only the 639 held-out rows are comparable to a prompted coder like grok,
   which never saw any of this data. The all-5,720 figure is memorisation.

2. GROUND TRUTH. For the 339 ratified rows a HUMAN label exists
   (labels_part1-4.jsonl). Those rows are scored against the human, which is
   the only segment where "correct" does not just mean "Opus said so". The
   same rows scored against Opus are printed underneath for comparability, and
   human-vs-Opus agreement is reported as calibration.

Usage: python3 score_ft_jira.py [ft_jira_eval.jsonl]
"""
import json
import os
import sys
from collections import Counter

EV = os.path.expanduser("~/Documents/procerno_eval")
FT = sys.argv[1] if len(sys.argv) > 1 else f"{EV}/finetune/ft_jira_eval.jsonl"

load = lambda p, key="id": {
    json.loads(l)[key]: json.loads(l) for l in open(p) if l.strip()
}

opus = load(f"{EV}/jira/opus_full_jira.jsonl")
ft = load(FT, "responseId")

human = {}
for i in range(1, 5):
    human.update(load(f"{EV}/jira/labels_part{i}.jsonl"))

val_ids = set(json.load(open(f"{EV}/finetune/split.json"))["val"])
ref_ids = set(human)
train_ids = set(opus) - val_ids - ref_ids

norm = lambda b: (b or "").strip().lower()
if hasattr(json, "loads"):
    pass


def reasons_of(r):
    v = r.get("reasons") or []
    if isinstance(v, str):
        try:
            v = json.loads(v.replace("'", '"'))
        except Exception:
            v = []
    return set(map(norm, v))


def top_pick_of(r):
    v = r.get("top_pick")
    return "" if v in (None, "None", "none") else norm(v)


def score(ids, truth, pred=ft):
    c = Counter()
    conf = Counter()
    for rid in ids:
        L, C = truth.get(rid), pred.get(rid)
        if not L or not C:
            continue
        c["n"] += 1
        c["outcome"] += norm(C.get("outcome")) == norm(L.get("outcome"))
        c["framing"] += norm(C.get("target_framing")) == norm(L.get("target_framing"))
        c["top_pick"] += top_pick_of(C) == top_pick_of(L)
        cr, lr = reasons_of(C), reasons_of(L)
        hit = len(cr & lr)
        c["rp_n"] += hit
        c["rp_d"] += len(cr)
        c["rr_n"] += hit
        c["rr_d"] += len(lr)
        conf[(norm(L.get("outcome")), norm(C.get("outcome")))] += 1
    return c, conf


p = lambda a, b: f"{100*a/b:.1f}%" if b else "n/a"
hdr = f"{'segment':<36} {'n':>5}  {'outcome':>8} {'framing':>8} {'top_pick':>8}  {'reasonP':>8} {'reasonR':>8}"
line = lambda name, c: (
    f"{name:<36} {c['n']:>5}  {p(c['outcome'], c['n']):>8} {p(c['framing'], c['n']):>8} "
    f"{p(c['top_pick'], c['n']):>8}  {p(c['rp_n'], c['rp_d']):>8} {p(c['rr_n'], c['rr_d']):>8}"
)

ref_h, conf_ref_h = score(ref_ids, human)
ref_o, _ = score(ref_ids, opus)
val_c, _ = score(val_ids, opus)
held, conf_held = score(val_ids | ref_ids, opus)
tr, _ = score(train_ids, opus)
alls, _ = score(set(opus), opus)

print(f"opus rows {len(opus)}, ft rows {len(ft)}, human-ratified {len(human)}")
print(f"composition: {len(train_ids)} trained-on, {len(val_ids)} val, {len(ref_ids)} ratified\n")

print("=== HELD OUT - the numbers that count ===")
print(hdr)
print(line("ratified 339 vs HUMAN  <-- headline", ref_h))
print(line("  (same rows vs Opus, for compare)", ref_o))
print(line("val 300 vs Opus", val_c))
print(line("all held out 639 vs Opus", held))
print("\nBenchmark, grok-4-fast x decompose2 / +tiebreak (never trained):")
print("  outcome 77.1% / 79.0%   framing 80.0%   top_pick 86.5%")

print("\n=== Contaminated - trained on, memorisation not skill ===")
print(hdr)
print(line("trained-on 5,081 vs Opus", tr))
print(line("ALL 5,720 vs Opus (89% seen)", alls))

# calibration: how often the human and Opus agree on the same 339 rows
agree, n = Counter(), 0
for rid in ref_ids:
    H, O = human.get(rid), opus.get(rid)
    if not H or not O:
        continue
    n += 1
    agree["outcome"] += norm(H.get("outcome")) == norm(O.get("outcome"))
    agree["framing"] += norm(H.get("target_framing")) == norm(O.get("target_framing"))
    agree["top_pick"] += top_pick_of(H) == top_pick_of(O)
print(f"\nCalibration - human vs Opus on the same {n} ratified rows:")
print(f"  outcome {p(agree['outcome'], n)}   framing {p(agree['framing'], n)}   top_pick {p(agree['top_pick'], n)}")
print("  (this is the ceiling any coder can score against Opus on these rows)")

print("\nOutcome confusion on ratified 339 (human -> ft), share of errors:")
tot = sum(v for k, v in conf_ref_h.items() if k[0] != k[1])
for (lo, co), c in sorted(conf_ref_h.items(), key=lambda kv: -kv[1]):
    if lo != co:
        print(f"  {lo:>13} -> {co:<13} {c:>4}  ({p(c, tot)})")
