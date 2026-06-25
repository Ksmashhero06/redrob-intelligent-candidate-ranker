"""
sandbox_app.py — Redrob Candidate Ranker · Streamlit Sandbox

Upload a small JSON/JSONL candidate file (≤100 candidates),
rank them with the same logic as rank.py, and download the CSV.

Deploy to HuggingFace Spaces / Streamlit Cloud:
    streamlit run sandbox_app.py
"""

import csv
import io
import json
import sys
from pathlib import Path

import streamlit as st

# Import the identical scoring engine and honeypot detector directly from rank.py
sys.path.append(str(Path(__file__).parent))
try:
    from rank import (
        detect_honeypot,
        compute_score,
        generate_reasoning,
        DEFAULT_WEIGHTS
    )
except ImportError as e:
    st.error(f"Error importing from rank.py: {e}")
    sys.exit(1)

# ── Streamlit UI ──────────────────────────────────────────────────────────────

st.set_page_config(page_title="Redrob Candidate Ranker", page_icon="🎯", layout="wide")

st.title("🎯 Redrob Intelligent Candidate Ranker")
st.markdown("""
**Hackathon Sandbox** — Upload a JSON array or JSONL file of candidate profiles (≤100 candidates),
adjust scoring weights, and download the ranked CSV.

> This runs the exact same deterministic, CPU-only scoring engine as `rank.py`.
> No data is sent to any external API or LLM.
""")

# Sidebar: weights & About
st.sidebar.header("⚖️ Scoring Weights")
w_title = st.sidebar.slider("Title Fit", 0, 100, DEFAULT_WEIGHTS.get("titleFit", 50))
w_skill = st.sidebar.slider("Skill Depth", 0, 100, DEFAULT_WEIGHTS.get("skillDepth", 50))
w_exp   = st.sidebar.slider("Experience Band", 0, 100, DEFAULT_WEIGHTS.get("experienceBand", 50))
w_loc   = st.sidebar.slider("Location Fit", 0, 100, DEFAULT_WEIGHTS.get("locationFit", 50))
w_beh   = st.sidebar.slider("Behavioral Signal", 0, 100, DEFAULT_WEIGHTS.get("behavioralSignal", 50))

weights = {
    "titleFit": w_title,
    "skillDepth": w_skill,
    "experienceBand": w_exp,
    "locationFit": w_loc,
    "behavioralSignal": w_beh
}

st.sidebar.markdown("---")
st.sidebar.subheader("ℹ️ About This Sandbox")
st.sidebar.info("""
This sandbox environment imports and runs the **identical scoring engine** used in the final batch submission script (`rank.py`). 
All components including:
* **Honeypot Detection** (structural profile validations)
* **Cross-Field Corroboration** (validating skill duration and technical title alignment)
* **Keyword-Stuffer Penalties**
* **12-Signal Behavioral Modifier**

run completely locally/in-browser, ensuring 100% parity with the final output.
""")

# File upload
uploaded = st.file_uploader("Upload candidates (.json array or .jsonl)", type=["json", "jsonl"])

if uploaded:
    raw_text = uploaded.read().decode("utf-8", errors="replace").strip()

    # Parse
    candidates = []
    if raw_text.startswith("["):
        try:
            candidates = json.loads(raw_text)
            st.success(f"✅ Parsed {len(candidates)} candidates (JSON array)")
        except Exception as e:
            st.error(f"JSON parse error: {e}")
    else:
        for line in raw_text.splitlines():
            line = line.strip()
            if line:
                try:
                    candidates.append(json.loads(line))
                except:
                    pass
        st.success(f"✅ Parsed {len(candidates)} candidates (JSONL)")

    # Official specification limits input to <= 100 candidates
    if len(candidates) > 100:
        st.warning(f"Sandbox is capped at 100 candidates. Using first 100 of {len(candidates)}.")
        candidates = candidates[:100]

    if candidates:
        if st.button("🚀 Rank Candidates", type="primary"):
            with st.spinner("Scoring..."):
                results = []
                honeypots = []
                for c in candidates:
                    is_hp, hp_reason = detect_honeypot(c)
                    score = compute_score(c, weights)
                    reasoning = generate_reasoning(c, score)
                    entry = {
                        "candidate_id": c.get("candidate_id", ""),
                        "score": score,
                        "reasoning": reasoning,
                        "is_honeypot": is_hp,
                        "hp_reason": hp_reason,
                    }
                    if is_hp:
                        honeypots.append(entry)
                    else:
                        results.append(entry)

                # Sort using raw float precision to prevent tie collapse, secondary sorting on candidate_id ascending
                results.sort(key=lambda x: (-x["score"], x["candidate_id"]))
                for i, r in enumerate(results): 
                    r["rank"] = i + 1

            st.markdown(f"### Results — {len(results)} scored, {len(honeypots)} honeypots excluded")

            # Top N to show
            show_n = min(len(results), 100)

            # Build CSV in memory (exact 6 decimal place output matching batch run)
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["candidate_id", "rank", "score", "reasoning"])
            for r in results[:show_n]:
                w.writerow([r["candidate_id"], r["rank"], f"{r['score']:.6f}", r["reasoning"]])
            csv_str = buf.getvalue()

            st.download_button("⬇️ Download Ranked CSV", csv_str, "ranked_candidates.csv", "text/csv")

            # Display table
            import pandas as pd
            rows = [{
                "rank": r["rank"], 
                "candidate_id": r["candidate_id"], 
                "score": round(r["score"], 6), 
                "reasoning": r["reasoning"]
            } for r in results[:show_n]]
            df = pd.DataFrame(rows)
            st.dataframe(df, use_container_width=True, height=600)

            if honeypots:
                with st.expander(f"🚨 {len(honeypots)} Honeypots Detected"):
                    hp_rows = [{"candidate_id": h["candidate_id"], "reason": h["hp_reason"]} for h in honeypots]
                    st.dataframe(pd.DataFrame(hp_rows), use_container_width=True)

else:
    st.info("👆 Upload a file to get started. You can use `sample_candidates.json` from the hackathon bundle.")

st.markdown("---")
st.markdown(
    "**Redrob Hackathon — Intelligent Candidate Discovery & Ranking Challenge** · "
    "CPU-only · No network calls · No LLM inference"
)
