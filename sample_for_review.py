#!/usr/bin/env python3
import json
import gzip
import random
import sys
from pathlib import Path

# Import scoring functions from rank.py
sys.path.append(str(Path(__file__).parent))
try:
    from rank import compute_score, detect_honeypot, DEFAULT_WEIGHTS
except ImportError as e:
    print(f"Error importing from rank.py: {e}")
    sys.exit(1)

# AI/ML buzzwords for Pattern A
AI_ML_BUZZWORDS = [
    "embedding", "rag", "vector search", "vector db", "vector database",
    "pinecone", "weaviate", "qdrant", "milvus", "llm", "large language model",
    "transformer", "semantic search", "retrieval-augmented", "faiss", "annoy",
    "machine learning", "deep learning", "neural network", "natural language",
    "nlp", "information retrieval", "ndcg", "mrr", "map", "rerank", "hybrid search"
]

def matches_pattern_a(c):
    """
    Pattern (a): profile.skills contains 3+ AI/ML skill names but duration_months 
    are all < 3 months AND current_title/career_history show no AI/ML-related work.
    """
    skills = c.get("skills") or []
    profile = c.get("profile") or {}
    history = c.get("career_history") or []
    
    # 1. profile.skills contains 3+ AI/ML-sounding skill names
    matching_skills = []
    for s in skills:
        name = (s.get("name") or "").lower()
        if any(bw in name for bw in AI_ML_BUZZWORDS):
            matching_skills.append(s)
            
    if len(matching_skills) < 3:
        return False
        
    # 2. skills' duration_months are all under 12 months
    if not all((s.get("duration_months") or 0) < 12 for s in matching_skills):
        return False
        
    # 3. current_title and career_history show no AI/ML-related work
    cur_title = (profile.get("current_title") or "").lower()
    if any(bw in cur_title for bw in AI_ML_BUZZWORDS):
        return False
        
    for job in history:
        t = (job.get("title") or "").lower()
        d = (job.get("description") or "").lower()
        if any(bw in t or bw in d for bw in AI_ML_BUZZWORDS):
            return False
            
    return True

def matches_pattern_b(c):
    """
    Pattern (b): career_history descriptions contain search/ranking/recommendation/retrieval 
    systems evidence, but current_title and skills do NOT contain obvious AI keywords.
    """
    skills = c.get("skills") or []
    profile = c.get("profile") or {}
    history = c.get("career_history") or []
    
    # 1. career_history descriptions contain search/ranking/recommendation/retrieval systems evidence
    has_evidence = False
    for job in history:
        d = (job.get("description") or "").lower()
        if any(term in d for term in ["search", "ranking", "recommendation", "retrieval"]):
            has_evidence = True
            break
            
    if not has_evidence:
        return False
        
    # Helper to check for obvious AI keywords (word boundaries for 'ai'/'ml')
    def has_obvious_kw(text):
        text = text.lower()
        words = text.replace("/", " ").replace("-", " ").split()
        if "ai" in words or "ml" in words:
            return True
        for kw in ["machine learning", "nlp", "search", "ranking", "retrieval", 
                   "recommendation", "embedding", "vector", "deep learning", 
                   "neural", "intelligence", "llm", "transformer"]:
            if kw in text:
                return True
        return False

    # 2. current_title and skills do NOT contain obvious AI keywords
    cur_title = (profile.get("current_title") or "").lower()
    if has_obvious_kw(cur_title):
        return False
        
    for s in skills:
        name = (s.get("name") or "").lower()
        if has_obvious_kw(name):
            return False
            
    return True

def main():
    candidates_path = Path("India_runs_data_and_ai_challenge/candidates.jsonl")
    if not candidates_path.exists():
        print(f"Error: {candidates_path} not found.")
        sys.exit(1)
        
    print("Loading candidates...")
    candidates = []
    open_fn = gzip.open if str(candidates_path).endswith(".gz") else open
    with open_fn(candidates_path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                candidates.append(json.loads(line))
                
    print(f"Loaded {len(candidates)} candidates.")
    
    # Score all non-honeypot candidates
    scored_candidates = []
    for c in candidates:
        is_hp, hp_reason = detect_honeypot(c)
        if is_hp:
            continue
        score = compute_score(c, DEFAULT_WEIGHTS)
        scored_candidates.append({
            "candidate": c,
            "score": score
        })
        
    # Sort by score descending to assign rank
    scored_candidates.sort(key=lambda x: (-x["score"], x["candidate"].get("candidate_id", "")))
    for rank_idx, sc in enumerate(scored_candidates):
        sc["rank"] = rank_idx + 1
        
    N = len(scored_candidates)
    print(f"Scored {N} non-honeypot candidates.")
    
    # Stratified deciles
    top_decile = scored_candidates[:N // 10]
    middle_range = scored_candidates[N * 4 // 10 : N * 6 // 10]
    bottom_decile = scored_candidates[N * 9 // 10 :]
    
    # Seed random number generator for reproducibility
    random.seed(42)
    
    selected_top = random.sample(top_decile, 5)
    selected_mid = random.sample(middle_range, 5)
    selected_bot = random.sample(bottom_decile, 5)
    
    # Collect IDs of already selected candidates to avoid duplicates
    selected_ids = {sc["candidate"].get("candidate_id") for sc in (selected_top + selected_mid + selected_bot)}
    
    # Identify edge cases
    candidates_a = []
    candidates_b = []
    
    for sc in scored_candidates:
        cid = sc["candidate"].get("candidate_id")
        if cid in selected_ids:
            continue
        if matches_pattern_a(sc["candidate"]):
            candidates_a.append(sc)
        elif matches_pattern_b(sc["candidate"]):
            candidates_b.append(sc)
            
    print(f"Found {len(candidates_a)} Pattern A (keyword-stuffers) and {len(candidates_b)} Pattern B (substance-no-buzzwords).")
    
    # Sample 5 edge cases (try to balance, e.g., 2 Pattern A and 3 Pattern B)
    selected_edge = []
    if len(candidates_a) >= 2 and len(candidates_b) >= 3:
        selected_edge.extend(random.sample(candidates_a, 2))
        selected_edge.extend(random.sample(candidates_b, 3))
    else:
        # Fallback to whatever matches we have
        all_edges = candidates_a + candidates_b
        if len(all_edges) >= 5:
            selected_edge = random.sample(all_edges, 5)
        else:
            selected_edge = all_edges
            
    # Combine all selected candidates in groups
    groups = [
        ("Top Decile (Top Fit)", selected_top),
        ("Middle Decile (Moderate Fit)", selected_mid),
        ("Bottom Decile (Low Fit)", selected_bot),
        ("JD Edge Cases (Pattern A & B)", selected_edge)
    ]
    
    # Write to review_sample.md
    with open("review_sample.md", "w", encoding="utf-8") as out:
        out.write("# Candidate Review Sample for Labeled Validation\n\n")
        out.write("This file contains 20 candidates selected for manual review to validate the scoring rubric:\n")
        out.write("- 5 from the Top Decile\n")
        out.write("- 5 from the Middle Deciles\n")
        out.write("- 5 from the Bottom Decile\n")
        out.write("- 5 specific JD Edge Cases (Pattern A: Keyword Stuffers, Pattern B: Substance-without-buzzwords)\n\n")
        
        for group_name, group_candidates in groups:
            out.write(f"## Group: {group_name}\n\n")
            for sc in group_candidates:
                c = sc["candidate"]
                profile = c.get("profile") or {}
                skills = c.get("skills") or []
                history = c.get("career_history") or []
                
                # Top 5 skills
                top_skills = sorted(skills, key=lambda x: (x.get("duration_months") or 0), reverse=True)[:5]
                skills_str = ", ".join([f"{s.get('name')} ({s.get('duration_months') or 0} mos)" for s in top_skills])
                
                # Pattern label if applicable
                pattern_label = ""
                if sc in selected_edge:
                    if matches_pattern_a(c):
                        pattern_label = " **[Pattern A: Potential Keyword Stuffer]**"
                    elif matches_pattern_b(c):
                        pattern_label = " **[Pattern B: Substance-without-buzzwords]**"
                
                out.write(f"### Candidate: `{c.get('candidate_id')}`{pattern_label}\n")
                out.write(f"- **Current Computed Score:** `{sc['score']:.4f}`\n")
                out.write(f"- **Current Rank:** {sc['rank']}\n")
                out.write(f"- **Headline:** {profile.get('headline', 'N/A')}\n")
                out.write(f"- **Current Title:** {profile.get('current_title', 'N/A')}\n")
                out.write(f"- **Years of Experience:** {profile.get('years_of_experience', 0)}\n")
                out.write(f"- **Top Skills:** {skills_str}\n\n")
                
                out.write("#### Career History (Top 3):\n")
                for job in history[:3]:
                    company = job.get("company", "N/A")
                    title = job.get("title", "N/A")
                    duration = job.get("duration_months") or 0
                    desc = job.get("description") or "N/A"
                    # Truncate description to 200 chars
                    if len(desc) > 200:
                        desc = desc[:200] + "..."
                    out.write(f"- **{title}** at *{company}* ({duration} mos):\n  > {desc}\n")
                out.write("\n---\n\n")
                
    print("Done! Review sample written to review_sample.md")

if __name__ == "__main__":
    main()
