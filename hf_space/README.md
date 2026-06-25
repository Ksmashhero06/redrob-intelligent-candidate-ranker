---
title: Redrob Candidate Ranker
emoji: 🎯
colorFrom: indigo
colorTo: blue
sdk: streamlit
sdk_version: "1.35.0"
app_file: app.py
pinned: false
license: mit
short_description: Intelligent candidate ranking for the Redrob Hackathon
---

# Redrob Intelligent Candidate Ranker — Sandbox

Upload a `.json` array or `.jsonl` file of candidate profiles (≤500 candidates),
adjust scoring weights with sliders, and download a ranked CSV.

**Reproduce the full submission:**
```bash
python rank.py --candidates ./candidates.jsonl --out ./submission.csv
```

This sandbox demonstrates the same CPU-only, no-network, deterministic scoring
engine used for the hackathon submission.
