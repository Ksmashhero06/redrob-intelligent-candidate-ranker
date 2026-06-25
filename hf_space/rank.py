#!/usr/bin/env python3
"""
rank.py — Redrob Intelligent Candidate Ranker (batch script)
v2: Enhanced with full behavioral signal suite, shipping-evidence career matching,
    education tier bonus, product company detection.

Scoring components:
  1. Title Fit        — keyword match in title/description, weighted recency × duration
                        + shipping-evidence bonus + product company bonus
  2. Skill Depth      — duration × proficiency × log(1+endorsements), assessment cross-check
  3. Experience Band  — Gaussian peak at 7 yrs + disqualifier penalties
                        + education tier bonus
  4. Location Fit     — tiered India cities + relocation bump
  [Behavioral Modifier]
  5. Behavioral Mod.  — 12-signal composite multiplier in [0.4, 1.15]

Honeypots (structurally impossible profiles) → score 0, excluded from top 100.

CLI:
    python rank.py --candidates path/to/candidates.jsonl --out submission.csv

Output CSV columns (exact):
    candidate_id,rank,score,reasoning
"""

import argparse
import csv
import gzip
import json
import math
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Reference date
# ──────────────────────────────────────────────────────────────────────────────
REF_DATE = datetime(2026, 6, 25)

# ──────────────────────────────────────────────────────────────────────────────
# Default weights
# ──────────────────────────────────────────────────────────────────────────────
DEFAULT_WEIGHTS = {
    "titleFit": 50,
    "skillDepth": 50,
    "experienceBand": 50,
    "locationFit": 50,
    "behavioralSignal": 50,
}

# ──────────────────────────────────────────────────────────────────────────────
# JD-derived constants
# ──────────────────────────────────────────────────────────────────────────────
SERVICE_COMPANIES = {"tcs", "infosys", "wipro", "accenture", "cognizant", "capgemini"}

# Skills mentioned in the JD as hard requirements or strong signals
TARGET_SKILLS = [
    "embeddings", "sentence-transformers", "sentence transformers",
    "vector db", "vector database", "vector search",
    "pinecone", "weaviate", "qdrant", "milvus", "opensearch",
    "elasticsearch", "faiss", "annoy", "scann",
    "python", "ndcg", "mrr", "map", "ranking", "retrieval",
    "hybrid search", "information retrieval", "reranking",
    "bi-encoder", "cross-encoder", "dense retrieval", "sparse retrieval",
    "bm25", "bge", "e5", "learning to rank", "ltr",
    "recommendation", "search engine",
]

# Keywords in job titles that indicate strong alignment with the JD
TITLE_KEYWORDS = [
    "ranking", "retrieval", "search", "recommend", "embed", "vector",
    "ndcg", "mrr", "nlp", "machine learning", "ml engineer",
    "ai engineer", "data scientist", "applied scientist",
    "applied ml", "applied ai", "staff ml", "senior ml",
    "information retrieval", "relevance", "personalization",
]

# Keywords in job descriptions that indicate relevant domain work
DESC_KEYWORDS = [
    "ranking", "retrieval", "search", "recommend", "embed", "vector",
    "ndcg", "mrr", "information retrieval", "rerank",
    "sentence transformer", "pinecone", "weaviate", "qdrant", "faiss",
    "elasticsearch", "opensearch", "relevance", "personalization",
    "recommendation engine", "search engine", "candidate ranking",
    "item ranking", "hybrid search", "dense retrieval", "sparse retrieval",
    "ltr", "learning to rank",
]

# Shipping/deployment evidence — distinguishes real practitioners from keyword stuffers
SHIPPING_KEYWORDS = [
    "deployed", "launched", "shipped", "production", "a/b test", "a/b testing",
    "served", "serving", "scale", "latency", "throughput", "real-time",
    "online", "live", "rollout", "canary", "shadow mode",
    "millions", "billion", "hundred million", "daily active",
    "user-facing", "end-to-end", "built and deployed", "led development",
]

# Bigrams indicating ownership of a retrieval/recommendation system
SYSTEM_BIGRAMS = [
    "recommendation system", "search system", "ranking system", "ranking pipeline",
    "retrieval system", "retrieval pipeline", "embedding pipeline",
    "search pipeline", "matching system", "matching engine",
    "recommendation engine", "relevance system", "ranking engine",
]

# Non-technical current title patterns → heavy penalty
NON_TECH_TITLES = [
    "marketing", "hr ", "human resources", "recruiter", "accountant",
    "finance", "sales", "support", "operations", "administrative",
    "legal", "designer", "content writer", "graphic", "business analyst",
    "project manager", "product owner", "scrum master",
]

# Architect/tech-lead drift detection
ARCHITECT_TITLES = ["architect", "lead", "manager", "director", "vp", "head of", "head,"]
CODING_KEYWORDS = [
    "code", "develop", "program", "python", "write", "implement", "build",
    "c++", "java", "rust", "typescript", "sql", "spark", "pytorch",
    "tensorflow", "sklearn", "numpy", "pandas", "jax",
]

# Proficiency multipliers
PROF_MULTIPLIERS = {"expert": 1.0, "advanced": 0.8, "intermediate": 0.5, "beginner": 0.25}

# Education tier scores
EDU_TIER_SCORES = {"tier_1": 1.0, "tier_2": 0.75, "tier_3": 0.5, "tier_4": 0.3, "unknown": 0.4}

# Company size buckets → product company prior
COMPANY_SIZE_SCORE = {
    "1-10": 0.6, "11-50": 0.65, "51-200": 0.75,
    "201-500": 0.85, "501-1000": 0.9, "1001-5000": 0.95,
    "5001-10000": 1.0, "10001+": 1.0,
}


# ──────────────────────────────────────────────────────────────────────────────
# Honeypot Detection (unchanged — structural impossibilities only)
# ──────────────────────────────────────────────────────────────────────────────
def detect_honeypot(candidate: dict):
    """Returns (is_honeypot: bool, reason: str)."""
    profile = candidate.get("profile", {})
    history = candidate.get("career_history", [])
    education = candidate.get("education", [])
    skills = candidate.get("skills", [])

    # Rule 1: Expert proficiency skill with duration_months == 0
    for s in skills:
        if s.get("proficiency") == "expert" and (s.get("duration_months", 0) or 0) <= 0:
            return True, f"Expert-level skill '{s.get('name')}' has 0 duration"

    # Rule 2: Claimed YOE inconsistent with sum of career history duration
    total_career_months = sum(j.get("duration_months", 0) or 0 for j in history)
    total_career_years = total_career_months / 12.0
    claimed_yoe = profile.get("years_of_experience", 0) or 0
    if abs(claimed_yoe - total_career_years) > 1.0:
        return True, f"Claimed YOE ({claimed_yoe:.1f}) inconsistent with career history ({total_career_years:.1f} yrs)"

    # Rule 3: Career history date checks
    for job in history:
        start_str = job.get("start_date")
        end_str = job.get("end_date")
        duration = job.get("duration_months", 0) or 0
        if start_str:
            try:
                start_dt = datetime.strptime(start_str, "%Y-%m-%d")
            except ValueError:
                continue
            if end_str:
                try:
                    end_dt = datetime.strptime(end_str, "%Y-%m-%d")
                except ValueError:
                    continue
                if start_dt > end_dt:
                    return True, f"Career start date ({start_str}) is after end date ({end_str})"
                diff_months = (end_dt.year - start_dt.year) * 12 + (end_dt.month - start_dt.month)
                if abs(diff_months - duration) > 2:
                    return True, f"Career duration {duration} months doesn't match start/end dates (diff={diff_months})"
            else:
                diff_months = (REF_DATE.year - start_dt.year) * 12 + (REF_DATE.month - start_dt.month)
                if duration > diff_months + 2:
                    return True, f"Current job duration ({duration} months) exceeds time since start date ({start_str})"

    # Rule 4: Education date sanity
    for edu in education:
        sy = edu.get("start_year")
        ey = edu.get("end_year")
        if sy and ey and int(sy) > int(ey):
            return True, f"Education start year ({sy}) is after end year ({ey})"

    return False, ""


# ──────────────────────────────────────────────────────────────────────────────
# Component 1: Title Fit
# ──────────────────────────────────────────────────────────────────────────────
def _is_title_non_technical(title: str) -> bool:
    title = title.lower()
    non_tech = ["marketing", "hr ", "human resources", "recruiter", "sales", "accountant", 
                "operations", "graphic", "civil engineer", "mechanical engineer", "content writer"]
    return any(kw in title for kw in non_tech)

def _is_job_non_technical(job: dict) -> bool:
    title = (job.get("title") or "").lower()
    desc = (job.get("description") or "").lower()
    
    non_tech_titles = ["marketing", "sales", "hr ", "human resources", "recruiter", 
                       "operations", "accounting", "accountant", "content writer", 
                       "graphic", "civil engineer", "mechanical engineer", "support", 
                       "business analyst", "project manager", "designer", "legal", 
                       "finance", "administrative"]
    title_non_tech = any(kw in title for kw in non_tech_titles)
    if not title_non_tech:
        return False
        
    # Check if description has technical terms
    tech_words = ["develop", "code", "programming", "software", "engineer", "ml", "ai", 
                  "data scientist", "database", "python", "java", "c++", "rust", 
                  "typescript", "golang", "backend", "frontend", "full stack", "qa", 
                  "test", "devops"]
    desc_has_tech = any(w in desc for w in tech_words)
    
    # Check if description matches known duplicate tech templates
    is_fake_tech = False
    if desc_has_tech:
        if "java backend development" in desc or "test automation and qa" in desc or "full-stack web application development" in desc:
            is_fake_tech = True
            
    if not desc_has_tech or is_fake_tech:
        return True
        
    return False

def _score_title_fit(profile: dict, history: list) -> float:
    """
    Weighted title match with description and shipping evidence bonuses.
    Description matches cannot drive high scores on their own.
    """
    if not history:
        return 0.0

    weighted_matches = 0.0
    weight_sum = 0.0

    for i, job in enumerate(history):
        title = (job.get("title") or "").lower()
        desc = (job.get("description") or "").lower()
        dur = job.get("duration_months") or 0
        company = (job.get("company") or "").lower()

        recency_w = 1.0 / (i + 1)
        dur_w = min(60.0, dur) / 12.0
        role_importance = recency_w * dur_w

        # 1. Base score from title alignment
        base_score = 0.0
        
        # Check if non-tech title
        non_tech = ["marketing", "hr ", "human resources", "recruiter", "sales", "accountant", 
                    "operations", "graphic", "civil engineer", "mechanical engineer", "content writer",
                    "support", "designer", "legal", "finance", "administrative", "project manager", "business analyst"]
        if any(kw in title for kw in non_tech):
            base_score = 0.0
        else:
            # Technical titles
            title_hits = sum(1 for k in TITLE_KEYWORDS if k in title)
            if title_hits > 0:
                base_score = min(0.80, 0.40 + title_hits * 0.15)
            else:
                # Check if it has tech title words
                tech = ["software", "engineer", "developer", "programmer", "coder", "architect", 
                        "lead", "scientist", "devops", "qa", "test", "web", "frontend", "backend", "fullstack", "full stack"]
                if any(kw in title for kw in tech):
                    base_score = 0.20
                else:
                    base_score = 0.05

        # 2. Add description bonuses ONLY if title is technical
        if base_score == 0.0:
            score = 0.0
        else:
            desc_hits = sum(1 for k in DESC_KEYWORDS if k in desc)
            ship_hits = sum(1 for k in SHIPPING_KEYWORDS if k in desc)
            bigram_hits = sum(1 for bg in SYSTEM_BIGRAMS if bg in desc or bg in title)
            
            # Capped description bonus
            desc_bonus = desc_hits * 0.04 + ship_hits * 0.04 + min(0.1, bigram_hits * 0.04)
            score = min(1.0, base_score + desc_bonus)
            
            # Product company bonus
            is_service = any(sc in company for sc in SERVICE_COMPANIES)
            if not is_service and i < 3:
                comp_size = job.get("company_size") or ""
                size_score = COMPANY_SIZE_SCORE.get(comp_size, 0.7)
                score = min(1.0, score + size_score * 0.05)

        weighted_matches += score * role_importance
        weight_sum += role_importance

    title_score = (weighted_matches / weight_sum) if weight_sum > 0 else 0.0

    # Penalize non-technical current titles
    cur_title = (profile.get("current_title") or "").lower()
    if _is_title_non_technical(cur_title):
        title_score *= 0.1

    return min(1.0, max(0.0, title_score))


# ──────────────────────────────────────────────────────────────────────────────
# Component 2: Skill Depth
# ──────────────────────────────────────────────────────────────────────────────
def _score_skill_depth(skills: list, signals: dict, history: list) -> float:
    """duration × proficiency × log(1+endorsements), assessment cross-check, with timeline and domain relevance corroboration."""
    assessment_scores = signals.get("skill_assessment_scores") or {}
    score_sum = 0.0

    for s in skills:
        name = (s.get("name") or "").lower()
        is_target = any(t in name for t in TARGET_SKILLS)
        if not is_target:
            continue

        prof = s.get("proficiency", "beginner")
        mult = PROF_MULTIPLIERS.get(prof, 0.25)
        dur = s.get("duration_months") or 0
        endorsements = s.get("endorsements") or 0

        skill_val = dur * mult * math.log1p(endorsements)

        # Timeline and domain relevance corroboration
        corroborated = False
        skill_start_dt = REF_DATE - timedelta(days=dur * 30.4) if dur > 0 else REF_DATE
        for job in history:
            start_str = job.get("start_date")
            if not start_str:
                continue
            try:
                job_start = datetime.strptime(start_str, "%Y-%m-%d")
            except ValueError:
                continue
            
            end_str = job.get("end_date")
            if end_str:
                try:
                    job_end = datetime.strptime(end_str, "%Y-%m-%d")
                except ValueError:
                    job_end = REF_DATE
            else:
                job_end = REF_DATE
                
            if job_start <= REF_DATE and job_end >= skill_start_dt:
                if not _is_job_non_technical(job):
                    # For generic Python, any technical job overlaps counts as corroboration.
                    # For specific AI/ML/Search/Retrieval skills, the job must show some relevant keywords in title/desc.
                    if "python" in name:
                        corroborated = True
                        break
                    else:
                        title = (job.get("title") or "").lower()
                        desc = (job.get("description") or "").lower()
                        has_kw = (
                            any(k in title for k in TITLE_KEYWORDS) or
                            any(k in desc for k in DESC_KEYWORDS) or
                            any(bg in title or bg in desc for bg in SYSTEM_BIGRAMS)
                        )
                        if has_kw:
                            corroborated = True
                            break
        
        if not corroborated:
            skill_val *= 0.25  # uncorroborated skill penalty

        # Assessment cross-check
        expected = {"expert": 85, "advanced": 70, "intermediate": 50, "beginner": 25}.get(prof, 25)
        assess_key = next((k for k in assessment_scores if name in k.lower() or k.lower() in name), None)
        if assess_key is not None:
            actual = assessment_scores[assess_key] or 0
            if actual < expected - 20:
                skill_val *= 0.4  # assessment gap penalty

        score_sum += skill_val

    # Normalize: 120 ≈ 2 strong well-evidenced skills
    return min(1.0, score_sum / 120.0)


# ──────────────────────────────────────────────────────────────────────────────
# Component 3: Experience Band
# ──────────────────────────────────────────────────────────────────────────────
def _score_experience_band(profile: dict, history: list, education: list) -> float:
    """Gaussian curve + disqualifier penalties + education tier bonus."""
    yoe = profile.get("years_of_experience") or 0

    # Gaussian peaking at 7 years (soft band 5-9)
    exp_score = math.exp(-0.5 * ((yoe - 7.0) / 2.0) ** 2)

    if history:
        companies = [(j.get("company") or "").lower() for j in history]

        # Pure service company penalty
        all_service = all(any(sc in c for sc in SERVICE_COMPANIES) for c in companies)
        if all_service:
            exp_score *= 0.25

        # Pure research/academic penalty
        def _is_academic(job: dict) -> bool:
            t = (job.get("title") or "").lower()
            d = (job.get("description") or "").lower()
            ind = (job.get("industry") or "").lower()
            return (
                "education" in ind or "research" in ind or "academic" in ind
                or any(k in t for k in ["researcher", "professor", "postdoc", "phd student"])
                or "academic" in d
            )

        if all(_is_academic(j) for j in history):
            exp_score *= 0.25

        # Architect/tech-lead drift
        recent = history[0]
        r_title = (recent.get("title") or "").lower()
        r_dur = recent.get("duration_months") or 0
        r_desc = (recent.get("description") or "").lower()
        is_lead = any(k in r_title for k in ARCHITECT_TITLES)
        has_coding = any(k in r_desc for k in CODING_KEYWORDS)
        if is_lead and r_dur >= 18 and not has_coding:
            exp_score *= 0.5

    # Education tier bonus (small, up to +10%)
    if education:
        best_tier_score = 0.0
        for edu in education:
            tier = (edu.get("tier") or "unknown").lower()
            ts = EDU_TIER_SCORES.get(tier, 0.4)
            best_tier_score = max(best_tier_score, ts)
        # Apply as a small bonus: tier_1 adds +6%, tier_2 +4%, unknown +2%
        edu_bonus = (best_tier_score - 0.4) * 0.15  # max +0.09 for tier_1
        exp_score = min(1.0, exp_score + max(0.0, edu_bonus))

    return min(1.0, max(0.0, exp_score))


# ──────────────────────────────────────────────────────────────────────────────
# Component 4: Location Fit
# ──────────────────────────────────────────────────────────────────────────────
def _score_location(profile: dict, signals: dict) -> float:
    """Tiered India city matching + relocation bump."""
    loc = (profile.get("location") or "").lower()
    country = (profile.get("country") or "").lower()

    if any(k in loc for k in ["pune", "noida"]):
        loc_score = 1.0
    elif any(k in loc for k in ["hyderabad", "mumbai", "delhi", "bangalore", "bengaluru",
                                  "ncr", "gurgaon", "gurugram"]):
        loc_score = 0.8
    elif "india" in country or any(k in loc for k in [
        "chennai", "kolkata", "ahmedabad", "jaipur", "chandigarh", "lucknow",
        "coimbatore", "kochi", "trivandrum", "nagpur", "indore", "vizag",
        "bhubaneswar", "surat", "vadodara", "patna", "ranchi",
        "tamil", "karnataka", "maharashtra", "telangana", "haryana",
    ]):
        loc_score = 0.5
    else:
        loc_score = 0.2

    willing = signals.get("willing_to_relocate") or False
    notice = signals.get("notice_period_days") or 0
    if loc_score < 0.8 and willing and notice <= 30:
        loc_score = min(0.8, loc_score + 0.3)

    return loc_score


# ──────────────────────────────────────────────────────────────────────────────
# Behavioral Modifier — enhanced with all 12 useful signals
# ──────────────────────────────────────────────────────────────────────────────
def _behavioral_modifier(signals: dict, beh_weight: float) -> float:
    """
    12-signal composite behavioral modifier in [0.4, 1.15].
    Signals used:
        recruiter_response_rate, last_active_date (decay), interview_completion_rate,
        open_to_work_flag, notice_period_days, github_activity_score,
        avg_response_time_hours, offer_acceptance_rate, saved_by_recruiters_30d,
        profile_completeness_score, verified_email+phone, linkedin_connected.
    """
    # Core engagement signals (same as before)
    response_rate = signals.get("recruiter_response_rate") or 0.0
    interview_rate = signals.get("interview_completion_rate") or 0.0
    open_to_work = bool(signals.get("open_to_work_flag"))
    notice_days = signals.get("notice_period_days") or 0

    # Activity decay: half-life 180 days
    active_decay = 1.0
    last_active_str = signals.get("last_active_date")
    if last_active_str:
        try:
            last_active = datetime.strptime(last_active_str, "%Y-%m-%d")
            diff_days = max(0.0, (REF_DATE - last_active).days)
            active_decay = math.exp(-diff_days / 180.0)
        except ValueError:
            pass

    notice_factor = 1.0 if notice_days <= 30 else (0.75 if notice_days <= 90 else 0.4)

    # GitHub activity (0-100, -1 if no GitHub linked)
    github_raw = signals.get("github_activity_score")
    if github_raw is None or github_raw < 0:
        github_factor = 0.4  # neutral-ish for no GitHub
    else:
        github_factor = min(1.0, github_raw / 100.0)

    # Average response time to recruiters
    avg_resp_h = signals.get("avg_response_time_hours") or 0
    if avg_resp_h <= 4:
        resp_time_factor = 1.0
    elif avg_resp_h <= 24:
        resp_time_factor = 0.8
    elif avg_resp_h <= 72:
        resp_time_factor = 0.5
    else:
        resp_time_factor = 0.2

    # Offer acceptance rate (-1 = no prior offers → treat as neutral 0.6)
    offer_raw = signals.get("offer_acceptance_rate")
    if offer_raw is None or offer_raw < 0:
        offer_factor = 0.6
    else:
        offer_factor = float(offer_raw)

    # Saved by recruiters in last 30d — market-validated signal
    saved = signals.get("saved_by_recruiters_30d") or 0
    saved_factor = min(1.0, math.log1p(saved) / math.log1p(30))  # log-normalized, 30 = max expected

    # Profile completeness — low = signals may be unreliable
    completeness = (signals.get("profile_completeness_score") or 0) / 100.0

    # Trust signals: verified email/phone + LinkedIn
    verified_email = bool(signals.get("verified_email"))
    verified_phone = bool(signals.get("verified_phone"))
    linkedin = bool(signals.get("linkedin_connected"))
    trust_factor = (
        (0.4 if verified_email else 0.0)
        + (0.3 if verified_phone else 0.0)
        + (0.3 if linkedin else 0.0)
    )  # max 1.0

    # Composite behavioral base (weights sum to ~1.0)
    behavioral_base = (
        response_rate    * 0.18
        + active_decay   * 0.16
        + interview_rate * 0.12
        + (0.08 if open_to_work else 0.02)
        + notice_factor  * 0.08
        + github_factor  * 0.10
        + resp_time_factor * 0.08
        + offer_factor   * 0.06
        + saved_factor   * 0.06
        + completeness   * 0.06
        + trust_factor   * 0.06
    )
    # behavioral_base is in [0, ~1.02] — clip to [0, 1]
    behavioral_base = min(1.0, max(0.0, behavioral_base))

    # Raw modifier in [0.4, 1.15] — slightly wider range than before
    raw_modifier = 0.4 + 0.75 * behavioral_base

    # Scale by behavioral slider weight
    scale = beh_weight / 100.0
    modifier = 1.0 + (raw_modifier - 1.0) * scale
    return modifier


# ──────────────────────────────────────────────────────────────────────────────
# Main Scoring
# ──────────────────────────────────────────────────────────────────────────────
def compute_score(candidate: dict, weights: dict) -> float:
    """
    Composite fit score in [0.0, 1.0].
    Returns 0.0 immediately for honeypots.
    """
    is_hp, _ = detect_honeypot(candidate)
    if is_hp:
        return 0.0

    profile = candidate.get("profile") or {}
    history = candidate.get("career_history") or []
    education = candidate.get("education") or []
    skills = candidate.get("skills") or []
    signals = candidate.get("redrob_signals") or {}

    title_score = _score_title_fit(profile, history)
    skill_score = _score_skill_depth(skills, signals, history)
    
    # Special keyword-stuffer penalty (non-technical current title + 3+ AI skills)
    cur_title = (profile.get("current_title") or "").lower()
    if _is_title_non_technical(cur_title):
        ai_skills_count = 0
        for s in skills:
            name = (s.get("name") or "").lower()
            is_target = any(t in name for t in TARGET_SKILLS)
            if is_target and (s.get("duration_months") or 0) > 12:
                ai_skills_count += 1
        if ai_skills_count >= 3:
            skill_score *= 0.5
            candidate["_is_keyword_stuffer"] = True
            
    exp_score = _score_experience_band(profile, history, education)
    loc_score = _score_location(profile, signals)

    w_title = weights.get("titleFit", 50)
    w_skill = weights.get("skillDepth", 50)
    w_exp = weights.get("experienceBand", 50)
    w_loc = weights.get("locationFit", 50)
    w_beh = weights.get("behavioralSignal", 50)

    w_sum = w_title + w_skill + w_exp + w_loc
    if w_sum > 0:
        base_score = (
            title_score * w_title
            + skill_score * w_skill
            + exp_score * w_exp
            + loc_score * w_loc
        ) / w_sum
    else:
        base_score = (title_score + skill_score + exp_score + loc_score) / 4.0

    beh_mod = _behavioral_modifier(signals, w_beh)
    final = base_score * beh_mod
    return min(1.0, max(0.0, final))


# ──────────────────────────────────────────────────────────────────────────────
# Reasoning Generation
# ──────────────────────────────────────────────────────────────────────────────
def generate_reasoning(candidate: dict, score: float) -> str:
    """1-2 sentence factual reasoning, sourced from candidate fields."""
    is_hp, reason = detect_honeypot(candidate)
    if is_hp:
        return f"HONEYPOT: {reason}"

    profile = candidate.get("profile", {})
    skills = candidate.get("skills", [])
    signals = candidate.get("redrob_signals", {})
    history = candidate.get("career_history", [])
    education = candidate.get("education", [])

    cur_title = profile.get("current_title", "Engineer")
    yoe = profile.get("years_of_experience", 0)
    location = profile.get("location", "Unknown")
    response_rate = int((signals.get("recruiter_response_rate") or 0) * 100)

    # Highest-duration JD-target skill
    best_skill, best_dur = "", 0
    for s in skills:
        name = (s.get("name") or "").lower()
        if any(t in name for t in TARGET_SKILLS):
            d = s.get("duration_months") or 0
            if d > best_dur:
                best_dur = d
                best_skill = s.get("name", "")
    skill_str = f"; strong in {best_skill} ({best_dur} mos)" if best_skill else ""

    # Key evidence keyword from career history
    title_ev = ""
    for job in history[:2]:
        desc = (job.get("description") or "").lower()
        for kw in ["recommendation", "retrieval", "search", "ranking", "embedding", "vector", "ranking system", "search system"]:
            if kw in desc:
                title_ev = f"; built {kw} systems at {job.get('company', '')}"
                break
        if title_ev:
            break

    # Education highlight
    edu_str = ""
    for edu in education:
        tier = (edu.get("tier") or "").lower()
        if tier == "tier_1":
            edu_str = f"; {edu.get('institution', 'tier-1 institution')}"
            break

    # GitHub signal if strong
    gh = signals.get("github_activity_score") or -1
    gh_str = f"; GitHub score {gh:.0f}" if gh >= 60 else ""
    stuffer_note = " Note: AI skills listed without corroborating technical career history." if candidate.get("_is_keyword_stuffer") else ""

    return (
        f"{cur_title} in {location} with {yoe} yrs exp"
        f"{skill_str}{title_ev}{edu_str}{gh_str}; recruiter response rate {response_rate}%.{stuffer_note}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Main Batch Runner
# ──────────────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Redrob Intelligent Candidate Ranker v2")
    parser.add_argument("--candidates", required=True, help="Path to candidates.jsonl or .jsonl.gz or .json array")
    parser.add_argument("--out", required=True, help="Output CSV file path")
    args = parser.parse_args()

    candidates_path = Path(args.candidates)
    out_path = Path(args.out)

    if not candidates_path.exists():
        print(f"Error: {candidates_path} not found.", file=sys.stderr)
        sys.exit(1)

    weights = DEFAULT_WEIGHTS.copy()
    print(f"Loading candidates from {candidates_path}...")

    results = []
    honeypot_count = 0
    total = 0

    open_fn = gzip.open if str(candidates_path).endswith(".gz") else open

    def iter_candidates(path, open_fn):
        with open_fn(path, "rt", encoding="utf-8") as f:
            first_char = f.read(1)
            f.seek(0)
            if first_char == "[":
                data = json.load(f)
                yield from data
            else:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            yield json.loads(line)
                        except json.JSONDecodeError:
                            continue

    for c in iter_candidates(candidates_path, open_fn):
        total += 1
        is_hp, hp_reason = detect_honeypot(c)

        if is_hp:
            honeypot_count += 1
            continue

        score = compute_score(c, weights)
        reasoning = generate_reasoning(c, score)

        results.append({
            "candidate_id": c.get("candidate_id", ""),
            "score": score,
            "reasoning": reasoning,
        })

        if total % 10000 == 0:
            print(f"  Processed {total} candidates ({honeypot_count} honeypots excluded)...")

    print(f"\nTotal processed: {total}")
    print(f"Honeypots excluded: {honeypot_count}")
    print(f"Scored candidates: {len(results)}")

    # Sort by full unrounded score (unrounded float) to avoid tie collapse near the top,
    # then break ties alphabetically by candidate_id.
    # Note: Rounding only happens at the very last step during CSV output generation.
    results.sort(key=lambda x: (-x["score"], x["candidate_id"]))
    top100 = results[:100]

    for i, r in enumerate(top100):
        r["rank"] = i + 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["candidate_id", "rank", "score", "reasoning"])
        for r in top100:
            writer.writerow([r["candidate_id"], r["rank"], f"{r['score']:.6f}", r["reasoning"]])

    if top100:
        print(f"\nTop 100 written to: {out_path}")
        print(f"Score range: {top100[-1]['score']:.4f} - {top100[0]['score']:.4f}")
    print("Done.")


if __name__ == "__main__":
    main()
