"""Scores test D (battery lint + repair): planted-defect catch rates, flag
rate on real prompts, stability, repairs that introduce brand names, and
the prompts where the two models' majority verdicts disagree."""
import collections, json, os, re

D = os.path.expanduser("~/Documents/procerno_eval/internal_models/lint")
P = {"gpt-5-mini": (0.25, 2), "gpt-6-luna": (0.1, 0.5)}
BRAND_WORDS = ["jira", "asana", "trello", "clickup", "monday", "linear", "american express", "amex", "chase",
               "visa", "mastercard", "capital one", "citi", "discover", "netflix", "hulu", "disney", "prime video",
               "max", "pixel", "iphone", "samsung", "galaxy", "oneplus", "xiaomi"]


def brandish(t):
    return any(re.search(r"\b" + re.escape(w) + r"\b", t.lower()) for w in BRAND_WORDS)


data = {a: json.load(open(f"{D}/{a}.json")) for a in P}
out = ["| arm | planted unanchored caught | planted spec-sheet caught | real prompts flagged | same verdict all 3 runs | repairs adding a brand name | errors | cost |",
       "| --- | --- | --- | --- | --- | --- | --- | --- |"]
maj_by = {}
for arm, d in data.items():
    an = an_n = sp = sp_n = rf = rn = stab = stn = br = 0
    maj_by[arm] = {}
    for b, x in d["brands"].items():
        for p in x["prompts"]:
            vs = [run[p["text"]] for run in x["runs"]]
            iss = [tuple(sorted(v["issues"])) for v in vs]
            stn += 1
            stab += len(set(iss)) == 1
            maj_by[arm][p["text"]] = collections.Counter(iss).most_common(1)[0][0]
            if p["plant"] == "anchoring":
                an_n += len(vs); an += sum("anchoring" in i for i in iss)
            elif p["plant"] == "spec_sheet":
                sp_n += len(vs); sp += sum("spec_sheet" in i for i in iss)
            else:
                rn += len(vs); rf += sum(bool(i) for i in iss)
            for v in vs:
                if v["repaired"] and brandish(v["repaired"]) and not brandish(p["text"]):
                    br += 1
    cost = sum(r["inTok"] * P[r["model"]][0] / 1e6 + r["outTok"] * P[r["model"]][1] / 1e6 for r in d["usage"])
    out.append(f"| {arm} | {an}/{an_n} | {sp}/{sp_n} | {rf}/{rn} ({100 * rf / rn:.0f}%) | {100 * stab / stn:.0f}% | {br} | {len(d['errors'])} | ${cost:.3f} |")
a, b = list(P)
common = [t for t in maj_by[a] if t in maj_by[b]]
agree = sum(maj_by[a][t] == maj_by[b][t] for t in common)
out.append(f"\nMajority-verdict agreement between the models: {agree}/{len(common)} ({100 * agree / len(common):.0f}%)")
out.append("\nReal prompts where the models disagree (majority verdicts):")
for bname, x in data[a]["brands"].items():
    for p in x["prompts"]:
        t = p["text"]
        if not p["plant"] and maj_by[a][t] != maj_by[b][t]:
            out.append(f"- [{bname}] gpt-5-mini={list(maj_by[a][t]) or 'ok'} gpt-6-luna={list(maj_by[b][t]) or 'ok'}: {t[:170]}")
open(f"{D}/score.md", "w").write("\n".join(out) + "\n")
print("\n".join(out))
