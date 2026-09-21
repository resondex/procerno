"""Does a blind-generated codebook recover the ground-truth convention?

Two Opus coders ran over the SAME 150 held-out jira rows. One saw bare code
names, the other saw definitions generated from 60 uncoded answers by a model
with no access to any labels. Both are scored against opus_full_jira labels.

If definitions help, the generator recovered a real convention. If they hurt,
it invented a plausible but wrong one - which is the failure mode that would
otherwise go undetected on a brand-new client.
"""
import ast, json, os, sys
from collections import Counter

SP = os.path.dirname(os.path.abspath(__file__))
norm = lambda s: (s or "").strip().lower()

def reasons(r):
    v = r.get("reasons") or []
    if isinstance(v, str):
        try: v = ast.literal_eval(v)
        except Exception: v = []
    return set(map(norm, v or []))

truth = {json.loads(l)["id"]: json.loads(l) for l in open(f"{SP}/val_truth_jira.jsonl") if l.strip()}

def load(p):
    if not os.path.exists(p): return None
    return {json.loads(l)["id"]: json.loads(l) for l in open(p) if l.strip()}

def score(pred):
    c = Counter()
    for rid, L in truth.items():
        C = pred.get(rid)
        if C is None: continue
        t, p = reasons(L), reasons(C)
        hit = len(t & p)
        c["n"] += 1; c["tp"] += hit; c["pred"] += len(p); c["true"] += len(t)
        c["exact"] += (t == p)
    return c

pct = lambda a, b: f"{100*a/b:.1f}%" if b else "n/a"
print(f"validation: {len(truth)} held-out jira rows, ground truth = opus_full_jira\n")
print(f"{'condition':<22} {'n':>4} {'precision':>10} {'recall':>8} {'F1':>7} {'exact-set':>10} {'codes/row':>10}")
res = {}
for name, path in (("bare code names", f"{SP}/val_pred_bare.jsonl"),
                   ("generated defs", f"{SP}/val_pred_defs.jsonl")):
    pred = load(path)
    if pred is None:
        print(f"{name:<22} (not yet written)"); continue
    c = score(pred); res[name] = c
    p = 100*c["tp"]/c["pred"] if c["pred"] else 0
    r = 100*c["tp"]/c["true"] if c["true"] else 0
    f1 = 2*p*r/(p+r) if p+r else 0
    print(f"{name:<22} {c['n']:>4} {p:>9.1f}% {r:>7.1f}% {f1:>6.1f} {pct(c['exact'],c['n']):>10} {c['pred']/c['n']:>10.2f}")
if truth:
    tc = sum(len(reasons(L)) for L in truth.values())
    print(f"{'(truth)':<22} {len(truth):>4} {'-':>10} {'-':>8} {'-':>7} {'-':>10} {tc/len(truth):>10.2f}")

if len(res) == 2:
    a, b = res["bare code names"], res["generated defs"]
    f = lambda c: (lambda p, r: 2*p*r/(p+r) if p+r else 0)(
        100*c["tp"]/c["pred"] if c["pred"] else 0, 100*c["tp"]/c["true"] if c["true"] else 0)
    print(f"\nF1 delta from definitions: {f(b)-f(a):+.1f} points")
    print(f"exact-set-match delta:     {100*(b['exact']-a['exact'])/b['n']:+.1f} points")
