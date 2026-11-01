#!/usr/bin/env python3
"""Exact Kiro credit usage from Kiro's own session files (no need to read the usage % in the app).

Every kiro-cli turn writes a `usage_summary` record (credits) to ~/.kiro/sessions/<hash>/sess_<id>/messages.jsonl,
and session.json beside it names the working folder, agent profile, model and effort.

usage: kiro-usage.py [--since 2026-11-01T19:00] [--until ...] [--by workspace|prefix|model|hour] [--top 30]
  --since/--until  UTC ISO prefixes (the records are UTC)
  --by prefix      groups working folders by the text before the first '-' (e.g. reader-AMZN -> reader)
"""
import argparse, collections, glob, json, os

def rows():
    for f in glob.glob(os.path.expanduser("~/.kiro/sessions/*/sess_*/messages.jsonl")):
        try:
            meta = json.load(open(os.path.join(os.path.dirname(f), "session.json")))
        except (OSError, ValueError):
            meta = {}
        ws = os.path.basename((meta.get("workspacePaths") or ["?"])[0])
        for ln in open(f, errors="ignore"):
            if '"usage_summary"' not in ln:
                continue
            d = json.loads(ln)
            yield {"ts": d["timestamp"], "workspace": ws, "agent": meta.get("agentMode"), "model": meta.get("modelId"),
                   "effort": meta.get("effortLevel"), "title": meta.get("title", ""),
                   "credits": sum(x.get("usage", 0) for x in d["payload"].get("promptTurnSummaries", []))}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=""); ap.add_argument("--until", default="9")
    ap.add_argument("--by", default="workspace", choices=["workspace", "prefix", "model", "hour"])
    ap.add_argument("--top", type=int, default=30)
    a = ap.parse_args()
    key = {"workspace": lambda r: r["workspace"], "prefix": lambda r: f"{r['workspace'].split('-')[0]} ({r['agent']}, {r['effort']})",
           "model": lambda r: f"{r['model']} {r['effort']}", "hour": lambda r: r["ts"][:13]}[a.by]
    g = collections.defaultdict(lambda: [0, 0.0])
    for r in rows():
        if a.since <= r["ts"] < a.until:
            g[key(r)][0] += 1
            g[key(r)][1] += r["credits"]
    tot = sum(v[1] for v in g.values())
    print(f"{'group':40s} {'turns':>5s} {'credits':>8s} {'per turn':>8s}")
    for k, (n, c) in sorted(g.items(), key=lambda x: (x[0] if a.by == "hour" else -x[1][1]))[:a.top]:
        print(f"{k[:40]:40s} {n:5d} {c:8.2f} {c / n:8.2f}")
    print(f"{'TOTAL':40s} {sum(v[0] for v in g.values()):5d} {tot:8.2f}")

if __name__ == "__main__":
    main()
