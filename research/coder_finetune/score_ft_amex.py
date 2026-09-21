"""Score the jira-trained fine-tune on American Express - a TRANSFER test.

The adapter saw only jira during training, so all 5,390 AmEx rows are held out
by construction: no contamination caveat applies here, unlike the jira eval.
Ground truth is opus_full_amex.jsonl (run 34d46b95, coded from the vault; prod
untouched). AmEx ground-truth rows store reasons as a Python-literal string and
top_pick as the string "None", so both are normalised before comparing.

Usage: python3 score_ft_amex.py [ft_amex_eval.jsonl]
"""
import ast
import json
import os
import sys
from collections import Counter, defaultdict

EV = os.path.expanduser("~/Documents/procerno_eval")
FT = sys.argv[1] if len(sys.argv) > 1 else f"{EV}/finetune/ft_amex_eval.jsonl"

truth = {}
for l in open(f"{EV}/amex/opus_full_amex.jsonl"):
    if l.strip():
        r = json.loads(l)
        truth[r["id"]] = r

ft = {}
for l in open(FT):
    if l.strip():
        r = json.loads(l)
        ft[r["responseId"]] = r

norm = lambda b: (b or "").strip().lower()


def top_pick_of(r):
    v = r.get("top_pick")
    return "" if v in (None, "None", "none", "") else norm(v)


def reasons_of(r):
    v = r.get("reasons") or []
    if isinstance(v, str):
        try:
            v = ast.literal_eval(v)
        except Exception:
            v = []
    return set(map(norm, v or []))


ALLOWED = set(map(norm, json.load(open(f"{EV}/amex/amex_taxonomy.json"))["reason_taxonomy"]))

c = Counter()
conf = Counter()
eng = defaultdict(Counter)
dist_t, dist_p = Counter(), Counter()
missing = 0
for rid, L in truth.items():
    C = ft.get(rid)
    if not C:
        missing += 1
        continue
    ok_out = norm(C.get("outcome")) == norm(L.get("outcome"))
    ok_fr = norm(C.get("target_framing")) == norm(L.get("target_framing"))
    ok_tp = top_pick_of(C) == top_pick_of(L)
    cr, lr = reasons_of(C), reasons_of(L)
    hit = len(cr & lr)
    c["n"] += 1
    c["outcome"] += ok_out
    c["framing"] += ok_fr
    c["top_pick"] += ok_tp
    c["rp_n"] += hit
    c["rp_d"] += len(cr)
    c["rr_n"] += hit
    c["rr_d"] += len(lr)
    c["offtax"] += len(cr - ALLOWED)
    conf[(norm(L.get("outcome")), norm(C.get("outcome")))] += 1
    dist_t[norm(L.get("outcome"))] += 1
    dist_p[norm(C.get("outcome"))] += 1
    e = eng[C.get("engine") or "?"]
    e["n"] += 1
    e["outcome"] += ok_out
    e["framing"] += ok_fr

p = lambda a, b: f"{100*a/b:.1f}%" if b else "n/a"
print(f"truth rows {len(truth)}, ft rows {len(ft)}, unmatched {missing}")
print("all rows are held out - the adapter trained on jira only\n")

print(f"{'segment':<34} {'n':>5}  {'outcome':>8} {'framing':>8} {'top_pick':>8}  {'reasonP':>8} {'reasonR':>8}")
print(
    f"{'AmEx transfer (all 5,390)':<34} {c['n']:>5}  {p(c['outcome'], c['n']):>8} "
    f"{p(c['framing'], c['n']):>8} {p(c['top_pick'], c['n']):>8}  "
    f"{p(c['rp_n'], c['rp_d']):>8} {p(c['rr_n'], c['rr_d']):>8}"
)
print("\nReference points:")
print("  jira held out (639, in-domain)       outcome 93.1%  framing 90.5%  top_pick 95.3%")
print("  jira ratified (339, hard, in-domain) outcome 90.6%  framing 87.3%  top_pick 94.1%")
print("  grok decompose2/+tiebreak on jira    outcome 77.1% / 79.0%")
print(f"\nOff-taxonomy reason codes emitted: {c['offtax']} of {c['rp_d']} predicted codes")

print("\nOutcome distribution (truth vs prediction):")
for k in sorted(set(dist_t) | set(dist_p)):
    print(f"  {k:<14} truth {dist_t[k]:>5} ({p(dist_t[k], c['n'])})   ft {dist_p[k]:>5} ({p(dist_p[k], c['n'])})")

print("\nOutcome confusion (truth -> ft), share of errors:")
tot = sum(v for k, v in conf.items() if k[0] != k[1])
for (lo, co), n in sorted(conf.items(), key=lambda kv: -kv[1]):
    if lo != co:
        print(f"  {lo:>13} -> {co:<13} {n:>4}  ({p(n, tot)})")

print("\nPer answer engine:")
for m, e in sorted(eng.items(), key=lambda kv: -kv[1]["n"]):
    print(f"  {m:<30} n={e['n']:<5} outcome {p(e['outcome'], e['n']):>7}  framing {p(e['framing'], e['n']):>7}")
