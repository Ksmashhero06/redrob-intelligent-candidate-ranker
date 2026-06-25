# Redrob — Intelligent Candidate Discovery & Ranking

**Hackathon:** Redrob India Runs Data & AI Challenge  
**Challenge:** Intelligent Candidate Discovery & Ranking  
**Team:** Ksmashhero06

---

## Quick Start

### Prerequisites
```bash
pip install streamlit pandas  # only needed for the sandbox UI
# rank.py itself uses only Python stdlib (no pip installs required)
```

### Reproduce the submission

```bash
python rank.py --candidates ./India_runs_data_and_ai_challenge/candidates.jsonl --out ./submission.csv
```

- **Runtime:** ~30 seconds on CPU (no GPU required)
- **Memory:** < 2 GB RAM
- **Network:** none (fully offline)
- **Output:** `submission.csv` — 100 rows, validated by `validate_submission.py`

### Validate the output

```bash
python India_runs_data_and_ai_challenge/validate_submission.py submission.csv
# → Submission is valid.
```

### Run the sandbox UI (Streamlit)

```bash
streamlit run sandbox_app.py
# Open http://localhost:8501
# Upload any .json or .jsonl candidate file (≤500 candidates)
```

---

## Architecture

### `rank.py` — Batch Scorer

Pure Python, stdlib only. Five scoring components + multiplicative behavioral modifier:

| Component | Weight | What it measures |
|---|---|---|
| **Title Fit** | 25% | Keyword relevance of job titles & descriptions, weighted by recency × duration. Includes shipping-evidence bonus (production/deployed/A/B test) and product-company detection |
| **Skill Depth** | 25% | `duration_months × proficiency_multiplier × log(1+endorsements)` for JD-relevant skills, cross-checked against platform assessment scores |
| **Experience Band** | 25% | Gaussian curve peaking at 7 years. Penalties for pure-service-company, pure-academic, and architect-drift careers. Education tier bonus for tier_1/tier_2 institutions |
| **Location Fit** | 25% | Tiered India city scoring (Pune/Noida → 1.0, metro → 0.8, other India → 0.5, overseas → 0.2) |
| **Behavioral Modifier** | ×mult | 12-signal composite multiplier [0.4, 1.15]: recruiter response rate, activity decay, interview completion, GitHub activity, response time, offer acceptance rate, saved by recruiters, profile completeness, verified email/phone, LinkedIn |

**Honeypot Detection:** Four structural rules eliminating ~70 impossible profiles:
1. Expert-proficiency skill with 0 duration_months
2. Claimed YOE inconsistent with career history sum (> 1 year gap)
3. Inverted or impossible career dates (start > end, or duration > elapsed calendar time)
4. Inverted education dates (start_year > end_year)

### `sandbox_app.py` — Streamlit UI

Wraps the same scoring logic with a browser interface. Upload JSON/JSONL → adjust weight sliders → download CSV. Capped at 500 candidates for the sandbox.

### `src/` — React UI

Interactive web application built with Vite + React. Same scoring logic ported to TypeScript (`src/utils/scoring.ts`). Supports drag-and-drop upload, live weight adjustment, and CSV export.

---

## File Structure

```
rank.py                          # Primary submission scorer (run this)
sandbox_app.py                   # Streamlit sandbox UI
submission.csv                   # Final submission (top 100)
submission_metadata.yaml         # Submission metadata (fill phone before upload)
src/
  utils/scoring.ts               # TypeScript scoring (same logic, for React UI)
  App.tsx / components/          # React frontend
India_runs_data_and_ai_challenge/
  candidates.jsonl               # 100k candidate pool
  validate_submission.py         # Official format validator
  candidate_schema.json          # Candidate data schema
  sample_candidates.json         # First 50 candidates (for quick testing)
```

---

## Design Decisions

**Why rule-based instead of embeddings/ML?**  
The challenge rules prohibit LLM API calls and require < 5 minutes CPU-only runtime. A learned ranking model would require pre-computed embeddings (offline step) and potentially > 16 GB RAM for 100k candidates. The rule-based approach runs in 30 seconds with 100% reproducibility and no pre-computation.

**Why Gaussian for experience band?**  
The JD says "5-9 years is a range, not a requirement" and they want people who understand retrieval "before it became fashionable." A hard cutoff would miss strong candidates at 4 or 10 years; the Gaussian peaks at 7 with graceful falloff in both directions.

**Why penalize service companies but not disqualify?**  
The JD says "if you're currently at one of these companies but have prior product-company experience, that's fine." The 0.25× penalty only applies if the *entire* career history is service companies.

**Why 12 behavioral signals?**  
The official signals doc says behavioral signals are "often more predictive of whether a candidate can actually be hired than their static profile." A perfect-on-paper candidate who hasn't logged in for 6 months and has a 5% response rate is, for hiring purposes, unavailable.
