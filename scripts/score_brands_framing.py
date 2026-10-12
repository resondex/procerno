"""Score the brands pass's per-name framing against labeler mentions.

Usage: python3 -I scripts/score_brands_framing.py <pass.jsonl> <labels.jsonl>

pass.jsonl   - scripts/pilot_brands_framing.mts output: {id, brands: [{name, framing}]}
labels.jsonl - labeler rows: {id (or responseId), mentions: [{brand, framing}]}

Only rows present in both files are scored. Names match case-insensitively on
the written form (trimmed, inner whitespace collapsed), one-to-one: a name
written twice must be detected twice to match twice. Framing agreement is
computed on matched names only; a pass entry with no valid framing scores as
"none". Stdlib only.
"""
import json
import sys
from collections import Counter, defaultdict

FRAMINGS = ["recommended", "mentioned", "negative"]


def norm(s):
    return " ".join(str(s).split()).lower()


def load(path, key_list, name_key):
    rows = {}
    with open(path, encoding="utf8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            rid = r.get("id") or r.get("responseId")
            items = []
            for m in r.get(key_list) or []:
                if isinstance(m, str):
                    m = {name_key: m, "framing": None}
                name = m.get(name_key)
                if not isinstance(name, str) or not name.strip():
                    continue
                fr = m.get("framing")
                fr = fr.strip().lower() if isinstance(fr, str) else None
                items.append((norm(name), fr if fr in FRAMINGS else None))
            rows[rid] = items
    return rows


def pct(n, d):
    return f"{100.0 * n / d:.1f}%" if d else "n/a"


def main(pass_path, label_path):
    got = load(pass_path, "brands", "name")
    ref = load(label_path, "mentions", "brand")
    ids = sorted(set(got) & set(ref))
    print(f"rows: pass {len(got)}, labels {len(ref)}, scored (both) {len(ids)}")
    if not ids:
        return
    n_ref = n_got = n_match = 0
    agree = 0
    by_label = Counter()
    agree_by_label = Counter()
    confusion = defaultdict(Counter)
    for rid in ids:
        pool = defaultdict(list)
        for name, fr in got[rid]:
            pool[name].append(fr)
        n_got += len(got[rid])
        for name, ref_fr in ref[rid]:
            n_ref += 1
            if not pool[name]:
                continue
            got_fr = pool[name].pop(0)
            n_match += 1
            ref_key = ref_fr or "none"
            got_key = got_fr or "none"
            by_label[ref_key] += 1
            confusion[ref_key][got_key] += 1
            if got_fr is not None and got_fr == ref_fr:
                agree += 1
                agree_by_label[ref_key] += 1
    print(f"label mentions {n_ref}; pass names {n_got}; matched {n_match}")
    print(f"name-match rate: of label mentions {pct(n_match, n_ref)} (recall); "
          f"of pass names {pct(n_match, n_got)} (precision)")
    print(f"framing agreement on matched names: {agree}/{n_match} = {pct(agree, n_match)}")
    cols = FRAMINGS + ["none"]
    for lab in cols:
        if by_label[lab]:
            print(f"  label {lab:<12} n={by_label[lab]:<5} agree {pct(agree_by_label[lab], by_label[lab])}")
    print("confusion (rows = label, cols = pass):")
    print("  " + " " * 13 + "".join(f"{c:>13}" for c in cols))
    for lab in cols:
        if by_label[lab]:
            print(f"  {lab:<13}" + "".join(f"{confusion[lab][c]:>13}" for c in cols))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
