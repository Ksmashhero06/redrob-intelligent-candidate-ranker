"""
sandbox_app.py — Redrob Candidate Ranker · Streamlit Sandbox

Upload a small JSON/JSONL candidate file (≤500 candidates),
rank them with the same logic as rank.py, and download the CSV.

Deploy to HuggingFace Spaces / Streamlit Cloud:
    streamlit run sandbox_app.py
"""

import csv
import io
import json
import math
import sys
from datetime import datetime
from pathlib import Path

import streamlit as st

# ── Copy of scoring logic from rank.py (kept in-sync manually) ────────────────
REF_DATE = datetime(2026, 6, 25)
DEFAULT_WEIGHTS = {"titleFit": 50, "skillDepth": 50, "experienceBand": 50, "locationFit": 50, "behavioralSignal": 50}
SERVICE_COMPANIES = {"tcs", "infosys", "wipro", "accenture", "cognizant", "capgemini"}
TARGET_SKILLS = ["embeddings","sentence-transformers","sentence transformers","vector db","vector database","vector search","pinecone","weaviate","qdrant","milvus","opensearch","elasticsearch","faiss","annoy","scann","python","ndcg","mrr","map","ranking","retrieval","hybrid search","information retrieval","reranking","bi-encoder","cross-encoder","dense retrieval","sparse retrieval","bm25","bge","e5","learning to rank","ltr","recommendation","search engine"]
TITLE_KEYWORDS = ["ranking","retrieval","search","recommend","embed","vector","ndcg","mrr","nlp","machine learning","ml engineer","ai engineer","data scientist","applied scientist","applied ml","applied ai","staff ml","senior ml","information retrieval","relevance","personalization"]
DESC_KEYWORDS = ["ranking","retrieval","search","recommend","embed","vector","ndcg","mrr","information retrieval","rerank","sentence transformer","pinecone","weaviate","qdrant","faiss","elasticsearch","opensearch","relevance","personalization","recommendation engine","search engine","hybrid search","dense retrieval","ltr","learning to rank"]
SHIPPING_KEYWORDS = ["deployed","launched","shipped","production","a/b test","a/b testing","served","serving","scale","latency","real-time","online","live","rollout","millions","user-facing","end-to-end","built and deployed"]
SYSTEM_BIGRAMS = ["recommendation system","search system","ranking system","ranking pipeline","retrieval system","retrieval pipeline","embedding pipeline","search pipeline","matching system","matching engine","recommendation engine","relevance system"]
NON_TECH_TITLES = ["marketing","hr ","human resources","recruiter","accountant","finance","sales","support","operations","administrative","legal","designer","content writer","graphic","business analyst","project manager","product owner"]
ARCHITECT_TITLES = ["architect","lead","manager","director","vp","head of","head,"]
CODING_KEYWORDS = ["code","develop","program","python","write","implement","build","c++","java","rust","typescript","sql","spark","pytorch","tensorflow","sklearn","numpy","pandas"]
PROF_MULTIPLIERS = {"expert": 1.0, "advanced": 0.8, "intermediate": 0.5, "beginner": 0.25}
EDU_TIER_SCORES = {"tier_1": 1.0, "tier_2": 0.75, "tier_3": 0.5, "tier_4": 0.3, "unknown": 0.4}
COMPANY_SIZE_SCORE = {"1-10": 0.6, "11-50": 0.65, "51-200": 0.75, "201-500": 0.85, "501-1000": 0.9, "1001-5000": 0.95, "5001-10000": 1.0, "10001+": 1.0}

def detect_honeypot(candidate):
    profile = candidate.get("profile", {})
    history = candidate.get("career_history", [])
    education = candidate.get("education", [])
    skills = candidate.get("skills", [])
    for s in skills:
        if s.get("proficiency") == "expert" and (s.get("duration_months", 0) or 0) <= 0:
            return True, f"Expert-level skill '{s.get('name')}' has 0 duration"
    total_months = sum(j.get("duration_months", 0) or 0 for j in history)
    claimed = profile.get("years_of_experience", 0) or 0
    if abs(claimed - total_months / 12.0) > 1.0:
        return True, f"Claimed YOE ({claimed:.1f}) inconsistent with career history ({total_months/12:.1f} yrs)"
    for job in history:
        start_str, end_str = job.get("start_date"), job.get("end_date")
        dur = job.get("duration_months", 0) or 0
        if start_str:
            try: start_dt = datetime.strptime(start_str, "%Y-%m-%d")
            except: continue
            if end_str:
                try: end_dt = datetime.strptime(end_str, "%Y-%m-%d")
                except: continue
                if start_dt > end_dt:
                    return True, f"Start date after end date for {job.get('company')}"
                diff = (end_dt.year - start_dt.year)*12 + (end_dt.month - start_dt.month)
                if abs(diff - dur) > 2:
                    return True, f"Duration mismatch for {job.get('company')}"
            else:
                diff = (REF_DATE.year - start_dt.year)*12 + (REF_DATE.month - start_dt.month)
                if dur > diff + 2:
                    return True, f"Current job duration exceeds time since {start_str}"
    for edu in education:
        sy, ey = edu.get("start_year"), edu.get("end_year")
        if sy and ey and int(sy) > int(ey):
            return True, f"Education start year > end year at {edu.get('institution')}"
    return False, ""

def compute_score(candidate, weights):
    is_hp, _ = detect_honeypot(candidate)
    if is_hp: return 0.0
    profile = candidate.get("profile", {})
    history = candidate.get("career_history", [])
    education = candidate.get("education", [])
    skills = candidate.get("skills", [])
    signals = candidate.get("redrob_signals", {})

    # Title Fit
    wm, ws = 0.0, 0.0
    ship_ev, bigram_h, pc_bonus = 0.0, 0, 0.0
    for i, job in enumerate(history):
        title = (job.get("title") or "").lower()
        desc = (job.get("description") or "").lower()
        dur = job.get("duration_months") or 0
        company = (job.get("company") or "").lower()
        rw = 1.0/(i+1); dw = min(60.0, dur)/12.0; ri = rw * dw
        th = sum(1 for k in TITLE_KEYWORDS if k in title)
        dh = sum(1 for k in DESC_KEYWORDS if k in desc)
        sc = min(1.0, th*0.35 + dh*0.12)
        wm += sc * ri; ws += ri
        sh = sum(1 for k in SHIPPING_KEYWORDS if k in desc)
        if sh > 0: ship_ev = max(ship_ev, min(1.0, sh*0.15)*rw)
        bh = sum(1 for bg in SYSTEM_BIGRAMS if bg in desc or bg in title)
        if bh > 0: bigram_h = max(bigram_h, bh)
        is_svc = any(sc in company for sc in SERVICE_COMPANIES)
        if not is_svc and i < 3:
            sz_sc = COMPANY_SIZE_SCORE.get(job.get("company_size") or "", 0.7)
            pc_bonus = max(pc_bonus, sz_sc * rw * 0.3)
    title_score = (wm/ws) if ws > 0 else 0.0
    title_score = min(1.0, title_score + ship_ev*0.15 + min(0.1, bigram_h*0.05) + pc_bonus*0.1)
    cur_t = (profile.get("current_title") or "").lower()
    if any(k in cur_t for k in NON_TECH_TITLES): title_score *= 0.1
    title_score = min(1.0, max(0.0, title_score))

    # Skill Depth
    asc = signals.get("skill_assessment_scores") or {}
    ss = 0.0
    for s in skills:
        name = (s.get("name") or "").lower()
        if not any(t in name for t in TARGET_SKILLS): continue
        prof = s.get("proficiency","beginner"); mult = PROF_MULTIPLIERS.get(prof, 0.25)
        dur = s.get("duration_months") or 0; end = s.get("endorsements") or 0
        sv = dur * mult * math.log1p(end)
        exp = {"expert":85,"advanced":70,"intermediate":50,"beginner":25}.get(prof, 25)
        ak = next((k for k in asc if name in k.lower() or k.lower() in name), None)
        if ak and (asc[ak] or 0) < exp - 20: sv *= 0.4
        ss += sv
    skill_score = min(1.0, ss / 120.0)

    # Experience Band
    yoe = profile.get("years_of_experience") or 0
    exp_score = math.exp(-0.5 * ((yoe - 7.0) / 2.0)**2)
    if history:
        comps = [(j.get("company") or "").lower() for j in history]
        if all(any(sc in c for sc in SERVICE_COMPANIES) for c in comps): exp_score *= 0.25
        def _acad(j):
            t=(j.get("title") or "").lower(); d=(j.get("description") or "").lower(); ind=(j.get("industry") or "").lower()
            return "education" in ind or "research" in ind or any(k in t for k in ["researcher","professor","postdoc"])
        if all(_acad(j) for j in history): exp_score *= 0.25
        r = history[0]; rt=(r.get("title") or "").lower(); rd=r.get("duration_months") or 0; rdesc=(r.get("description") or "").lower()
        if any(k in rt for k in ARCHITECT_TITLES) and rd >= 18 and not any(k in rdesc for k in CODING_KEYWORDS):
            exp_score *= 0.5
    if education:
        best_t = max(EDU_TIER_SCORES.get((edu.get("tier") or "unknown").lower(), 0.4) for edu in education)
        exp_score = min(1.0, exp_score + max(0.0, (best_t - 0.4) * 0.15))
    exp_score = min(1.0, max(0.0, exp_score))

    # Location
    loc = (profile.get("location") or "").lower(); country = (profile.get("country") or "").lower()
    if any(k in loc for k in ["pune","noida"]): loc_score = 1.0
    elif any(k in loc for k in ["hyderabad","mumbai","delhi","bangalore","bengaluru","ncr","gurgaon","gurugram"]): loc_score = 0.8
    elif "india" in country or any(k in loc for k in ["chennai","kolkata","ahmedabad","jaipur","chandigarh","lucknow","coimbatore","kochi","trivandrum","nagpur","indore","vizag","bhubaneswar"]): loc_score = 0.5
    else: loc_score = 0.2
    if loc_score < 0.8 and signals.get("willing_to_relocate") and (signals.get("notice_period_days") or 0) <= 30:
        loc_score = min(0.8, loc_score + 0.3)

    wt = weights.get("titleFit",50); wsk = weights.get("skillDepth",50); we = weights.get("experienceBand",50); wl = weights.get("locationFit",50); wb = weights.get("behavioralSignal",50)
    wsum = wt+wsk+we+wl
    base = (title_score*wt + skill_score*wsk + exp_score*we + loc_score*wl)/wsum if wsum>0 else (title_score+skill_score+exp_score+loc_score)/4

    # Behavioral
    rr = signals.get("recruiter_response_rate") or 0.0
    ir = signals.get("interview_completion_rate") or 0.0
    otw = bool(signals.get("open_to_work_flag"))
    nd = signals.get("notice_period_days") or 0
    ad = 1.0
    las = signals.get("last_active_date")
    if las:
        try: ad = math.exp(-max(0,(REF_DATE - datetime.strptime(las,"%Y-%m-%d")).days)/180.0)
        except: pass
    nf = 1.0 if nd<=30 else (0.75 if nd<=90 else 0.4)
    gh = signals.get("github_activity_score"); gf = 0.4 if (gh is None or gh<0) else min(1.0,gh/100)
    arh = signals.get("avg_response_time_hours") or 0; rtf = 1.0 if arh<=4 else (0.8 if arh<=24 else (0.5 if arh<=72 else 0.2))
    oar = signals.get("offer_acceptance_rate"); of = 0.6 if (oar is None or oar<0) else float(oar)
    sv = signals.get("saved_by_recruiters_30d") or 0; svf = min(1.0, math.log1p(sv)/math.log1p(30))
    comp = (signals.get("profile_completeness_score") or 0)/100.0
    tf = (0.4 if signals.get("verified_email") else 0) + (0.3 if signals.get("verified_phone") else 0) + (0.3 if signals.get("linkedin_connected") else 0)
    bb = min(1.0, max(0.0, rr*0.18+ad*0.16+ir*0.12+(0.08 if otw else 0.02)+nf*0.08+gf*0.10+rtf*0.08+of*0.06+svf*0.06+comp*0.06+tf*0.06))
    raw_mod = 0.4 + 0.75 * bb
    mod = 1.0 + (raw_mod - 1.0) * (wb/100.0)
    return min(1.0, max(0.0, base * mod))

def generate_reasoning(candidate, score):
    is_hp, reason = detect_honeypot(candidate)
    if is_hp: return f"HONEYPOT: {reason}"
    profile = candidate.get("profile", {}); signals = candidate.get("redrob_signals", {}); history = candidate.get("career_history", []); skills = candidate.get("skills", [])
    cur_title = profile.get("current_title","Engineer"); yoe = profile.get("years_of_experience",0); location = profile.get("location","Unknown")
    rr = int((signals.get("recruiter_response_rate") or 0)*100)
    best_skill, best_dur = "", 0
    for s in skills:
        nm = (s.get("name") or "").lower()
        if any(t in nm for t in TARGET_SKILLS):
            d = s.get("duration_months") or 0
            if d > best_dur: best_dur=d; best_skill=s.get("name","")
    sk = f"; strong in {best_skill} ({best_dur} mos)" if best_skill else ""
    ev = ""
    for job in history[:2]:
        desc = (job.get("description") or "").lower()
        for kw in ["recommendation","retrieval","search","ranking","embedding","vector"]:
            if kw in desc: ev = f"; built {kw} systems at {job.get('company','')}"; break
        if ev: break
    gh = signals.get("github_activity_score") or -1; ghs = f"; GitHub {gh:.0f}" if gh >= 60 else ""
    return f"{cur_title} in {location} with {yoe} yrs exp{sk}{ev}{ghs}; response rate {rr}%."

# ── Streamlit UI ──────────────────────────────────────────────────────────────

st.set_page_config(page_title="Redrob Candidate Ranker", page_icon="🎯", layout="wide")

st.title("🎯 Redrob Intelligent Candidate Ranker")
st.markdown("""
**Hackathon Sandbox** — Upload a JSON array or JSONL file of candidate profiles (≤500 candidates),
adjust scoring weights, and download the ranked CSV.

> This runs the exact same deterministic, CPU-only scoring engine as `rank.py`.
> No data is sent to any external API or LLM.
""")

# Sidebar: weights
st.sidebar.header("⚖️ Scoring Weights")
w_title = st.sidebar.slider("Title Fit", 0, 100, 50)
w_skill = st.sidebar.slider("Skill Depth", 0, 100, 50)
w_exp   = st.sidebar.slider("Experience Band", 0, 100, 50)
w_loc   = st.sidebar.slider("Location Fit", 0, 100, 50)
w_beh   = st.sidebar.slider("Behavioral Signal", 0, 100, 50)

weights = {"titleFit": w_title, "skillDepth": w_skill, "experienceBand": w_exp, "locationFit": w_loc, "behavioralSignal": w_beh}

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

    if len(candidates) > 500:
        st.warning(f"Sandbox is capped at 500 candidates. Using first 500 of {len(candidates)}.")
        candidates = candidates[:500]

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

                results.sort(key=lambda x: (-x["score"], x["candidate_id"]))
                for i, r in enumerate(results): r["rank"] = i + 1

            st.markdown(f"### Results — {len(results)} scored, {len(honeypots)} honeypots excluded")

            # Top N to show
            show_n = min(len(results), 100)

            # Build CSV in memory
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["candidate_id", "rank", "score", "reasoning"])
            for r in results[:show_n]:
                w.writerow([r["candidate_id"], r["rank"], f"{r['score']:.4f}", r["reasoning"]])
            csv_str = buf.getvalue()

            st.download_button("⬇️ Download Ranked CSV", csv_str, "ranked_candidates.csv", "text/csv")

            # Display table
            import pandas as pd
            rows = [{"rank": r["rank"], "candidate_id": r["candidate_id"], "score": round(r["score"], 4), "reasoning": r["reasoning"]} for r in results[:show_n]]
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
