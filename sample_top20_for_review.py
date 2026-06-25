#!/usr/bin/env python3
import json
import gzip
import csv
import sys
from pathlib import Path

# Import scoring functions from rank.py
sys.path.append(str(Path(__file__).parent))
try:
    from rank import (
        _score_title_fit,
        _score_skill_depth,
        _score_experience_band,
        _score_location,
        _behavioral_modifier,
        DEFAULT_WEIGHTS,
        detect_honeypot,
        compute_score
    )
except ImportError as e:
    print(f"Error importing from rank.py: {e}")
    sys.exit(1)

def main():
    submission_path = Path("submission.csv")
    candidates_path = Path("India_runs_data_and_ai_challenge/candidates.jsonl")
    
    if not submission_path.exists():
        print(f"Error: {submission_path} not found. Please run rank.py first.")
        sys.exit(1)
        
    if not candidates_path.exists():
        print(f"Error: {candidates_path} not found.")
        sys.exit(1)
        
    # 1. Read top 20 candidate IDs and ranks from submission.csv
    top20_meta = []
    with open(submission_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if len(top20_meta) >= 20:
                break
            top20_meta.append({
                "candidate_id": row["candidate_id"],
                "rank": int(row["rank"]),
                "csv_score": float(row["score"]),
                "reasoning": row["reasoning"]
            })
            
    top20_ids = {item["candidate_id"] for item in top20_meta}
    
    # 2. Lookup full records in candidates.jsonl
    raw_records = {}
    open_fn = gzip.open if str(candidates_path).endswith(".gz") else open
    print("Scanning candidates.jsonl for top 20 profiles...")
    with open_fn(candidates_path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                c = json.loads(line)
                cid = c.get("candidate_id")
                if cid in top20_ids:
                    raw_records[cid] = c
                    
    # 3. Format and write to top20_review.md
    out_path = Path("top20_review.md")
    print(f"Generating {out_path}...")
    with open(out_path, "w", encoding="utf-8") as out:
        out.write("# Top 20 Candidates Review & Score Breakdown\n\n")
        out.write("This file contains the top 20 ranked candidates from the regenerated `submission.csv` (post-corroboration-fix), with their full untruncated profile details and score breakdowns.\n\n")
        
        for item in top20_meta:
            cid = item["candidate_id"]
            c = raw_records.get(cid)
            if not c:
                out.write(f"## Rank {item['rank']}: Candidate `{cid}` (NOT FOUND IN JSONL)\n\n")
                continue
                
            profile = c.get("profile") or {}
            history = c.get("career_history") or []
            education = c.get("education") or []
            skills = c.get("skills") or []
            signals = c.get("redrob_signals") or {}
            
            # Compute sub-components
            title_score = _score_title_fit(profile, history)
            skill_score = _score_skill_depth(skills, signals, history)
            
            # Re-apply the special stuffer check on skill_score to show it accurately
            is_stuffer = False
            from rank import TARGET_SKILLS, _is_title_non_technical
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
                    is_stuffer = True
                    
            exp_score = _score_experience_band(profile, history, education)
            loc_score = _score_location(profile, signals)
            
            w_beh = DEFAULT_WEIGHTS.get("behavioralSignal", 50)
            beh_modifier = _behavioral_modifier(signals, w_beh)
            
            # Display candidate section
            out.write(f"## Rank {item['rank']}: Candidate `{cid}`\n\n")
            out.write(f"- **Final Score (in CSV):** `{item['csv_score']:.6f}`\n")
            out.write(f"- **Reasoning:** *\"{item['reasoning']}\"*\n")
            if is_stuffer:
                out.write("- **[SPECIAL PENALTY]** Flagged as likely Keyword-Stuffer (0.5x Skill Depth multiplier applied)\n")
            out.write("\n")
            
            # Score Breakdown table
            out.write("### Score Breakdown:\n")
            out.write("| Component | Raw Score | Weight | Weighted Score Contribution |\n")
            out.write("| :--- | :---: | :---: | :---: |\n")
            out.write(f"| **Title Fit** | `{title_score:.4f}` | 50 | `{title_score * 0.25:.4f}` |\n")
            out.write(f"| **Skill Depth** | `{skill_score:.4f}` | 50 | `{skill_score * 0.25:.4f}` |\n")
            out.write(f"| **Experience Band** | `{exp_score:.4f}` | 50 | `{exp_score * 0.25:.4f}` |\n")
            out.write(f"| **Location Fit** | `{loc_score:.4f}` | 50 | `{loc_score * 0.25:.4f}` |\n")
            out.write(f"| **Subtotal Base Score** | - | - | `{(title_score + skill_score + exp_score + loc_score) / 4.0:.4f}` |\n")
            out.write(f"| **Behavioral Modifier** | `x{beh_modifier:.4f}` | - | **Final: `{(title_score + skill_score + exp_score + loc_score) / 4.0 * beh_modifier:.4f}`** |\n\n")
            
            # Profile Metadata
            out.write("### Profile Summary:\n")
            out.write(f"- **Headline:** {profile.get('headline', 'N/A')}\n")
            out.write(f"- **Current Title:** {profile.get('current_title', 'N/A')}\n")
            out.write(f"- **Years of Experience:** {profile.get('years_of_experience', 0)}\n")
            out.write(f"- **Location:** {profile.get('location', 'N/A')}, {profile.get('country', 'N/A')}\n")
            out.write("\n")
            
            # All Skills
            out.write("### Skills:\n")
            skills_sorted = sorted(skills, key=lambda x: (x.get("duration_months") or 0), reverse=True)
            for s in skills_sorted:
                out.write(f"- {s.get('name')}: proficiency=`{s.get('proficiency')}`, duration=`{s.get('duration_months')}` mos, endorsements=`{s.get('endorsements')}`\n")
            out.write("\n")
            
            # All Career History
            out.write("### Career History:\n")
            for idx, job in enumerate(history):
                out.write(f"#### Job {idx+1}: {job.get('title')} at **{job.get('company')}**\n")
                out.write(f"- **Duration:** {job.get('duration_months', 0)} mos ({job.get('start_date')} to {job.get('end_date') or 'Present'})\n")
                out.write(f"- **Industry:** {job.get('industry', 'N/A')} | **Size:** {job.get('company_size', 'N/A')}\n")
                out.write(f"- **Description:**\n  {job.get('description', 'N/A')}\n\n")
                
            out.write("\n---\n\n")
            
    print("Done! top20_review.md written successfully.")

if __name__ == "__main__":
    main()
