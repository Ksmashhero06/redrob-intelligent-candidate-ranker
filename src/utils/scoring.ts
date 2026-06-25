import { Candidate, ScoringWeights } from '../types';

export interface HoneypotResult {
  isHoneypot: boolean;
  reason: string;
}

/**
 * Checks structurally if a candidate is a honeypot with impossible data.
 */
export function detectHoneypot(candidate: any): HoneypotResult {
  // Handle both UI Candidate wrapper and raw profile
  const raw = candidate.raw || candidate;
  if (!raw) {
    return { isHoneypot: false, reason: '' };
  }

  const profile = raw.profile || {};
  const history = raw.career_history || [];
  const education = raw.education || [];
  const skills = raw.skills || [];
  const signals = raw.redrob_signals || {};

  // Rule 1: Expert proficiency skill with duration_months <= 0
  for (const s of skills) {
    if (s.proficiency === 'expert' && (s.duration_months === undefined || s.duration_months <= 0)) {
      return {
        isHoneypot: true,
        reason: `HONEYPOT: Expert-level skill '${s.name}' has 0 or missing duration`
      };
    }
  }

  // Rule 2: Claimed years of experience wildly inconsistent with the sum of career history duration
  const totalCareerMonths = history.reduce((sum: number, job: any) => sum + (job.duration_months || 0), 0);
  const totalCareerYears = totalCareerMonths / 12;
  const claimedYoe = profile.years_of_experience || 0;
  if (Math.abs(claimedYoe - totalCareerYears) > 1.0) {
    return {
      isHoneypot: true,
      reason: `HONEYPOT: Claimed experience (${claimedYoe} yrs) is inconsistent with career history sum (${totalCareerYears.toFixed(1)} yrs)`
    };
  }

  // Rule 3: Career history date checks
  for (const job of history) {
    const startStr = job.start_date;
    const endStr = job.end_date;
    const duration = job.duration_months || 0;

    if (startStr) {
      const startDate = new Date(startStr);
      if (endStr) {
        const endDate = new Date(endStr);
        // Start date after end date
        if (startDate > endDate) {
          return {
            isHoneypot: true,
            reason: `HONEYPOT: Career start date (${startStr}) is after end date (${endStr}) for ${job.company}`
          };
        }
      } else {
        // Current job: duration cannot exceed the time elapsed from start_date to last_active_date
        const lastActiveStr = signals.last_active_date;
        if (lastActiveStr) {
          const lastActiveDate = new Date(lastActiveStr);
          if (startDate > lastActiveDate) {
            return {
              isHoneypot: true,
              reason: `HONEYPOT: Current job start date (${startStr}) is after last active date (${lastActiveStr})`
            };
          }
          const diffMonths = (lastActiveDate.getFullYear() - startDate.getFullYear()) * 12 + (lastActiveDate.getMonth() - startDate.getMonth());
          if (duration > diffMonths + 2) {
            return {
              isHoneypot: true,
              reason: `HONEYPOT: Current job duration of ${duration} months exceeds time since start date ${startStr}`
            };
          }
        }
      }
    }
  }

  // Rule 4: Education date checks
  for (const edu of education) {
    const start = edu.start_year;
    const end = edu.end_year;
    if (start && end && start > end) {
      return {
        isHoneypot: true,
        reason: `HONEYPOT: Education start year (${start}) is after end year (${end}) at ${edu.institution}`
      };
    }
  }

  return { isHoneypot: false, reason: '' };
}

/**
 * Computes the real candidate discovery score based on weights from the sliders.
 */
export function computeScore(candidate: any, weights: ScoringWeights): number {
  const raw = candidate.raw || candidate;
  if (!raw) return 0;

  // If candidate is a honeypot, return 0 score immediately
  if (detectHoneypot(raw).isHoneypot) {
    return 0;
  }

  const profile = raw.profile || {};
  const history = raw.career_history || [];
  const education = raw.education || [];
  const skills = raw.skills || [];
  const signals = raw.redrob_signals || {};

  // 1. TITLE FIT (0.0 to 1.0)
  let titleScore = 0;
  if (history.length > 0) {
    let weightedRoleMatches = 0;
    let roleWeightSum = 0;

    history.forEach((job: any, index: number) => {
      const title = (job.title || '').toLowerCase();
      const desc = (job.description || '').toLowerCase();
      const dur = job.duration_months || 0;

      // Recency weight: 1.0 for most recent, decays exponentially/harmonically
      const recencyWeight = 1.0 / (index + 1);
      const durationWeight = Math.min(60, dur) / 12.0; // cap duration weight at 5 years
      const roleImportance = recencyWeight * durationWeight;

      let score = 0;
      // Keywords representing search, ranking, retrieval, recommendation systems, or AI
      const titleKeywords = ['ranking', 'retrieval', 'search', 'recommend', 'embed', 'vector', 'ndcg', 'mrr', 'map', 'ai', 'ml', 'nlp', 'machine learning'];
      const descKeywords = ['ranking', 'retrieval', 'search', 'recommend', 'embed', 'vector', 'ndcg', 'mrr', 'map'];

      const titleMatches = titleKeywords.filter(k => title.includes(k)).length;
      const descMatches = descKeywords.filter(k => desc.includes(k)).length;

      score += titleMatches * 0.4;
      score += descMatches * 0.15;
      score = Math.min(1.0, score);

      weightedRoleMatches += score * roleImportance;
      roleWeightSum += roleImportance;
    });

    titleScore = roleWeightSum > 0 ? weightedRoleMatches / roleWeightSum : 0;
  }

  // Penalize non-technical current titles heavily (marketing manager, accountant, etc.)
  const curTitle = (profile.current_title || '').toLowerCase();
  const nonTechKeywords = ['marketing', 'hr ', 'recruiter', 'accountant', 'finance', 'sales', 'support', 'operations', 'administrative', 'legal'];
  if (nonTechKeywords.some(k => curTitle.includes(k))) {
    titleScore *= 0.1;
  }
  titleScore = Math.min(1.0, Math.max(0.0, titleScore));


  // 2. SKILL DEPTH (0.0 to 1.0)
  // Weight by duration_months * proficiency_multiplier * log(1 + endorsements)
  const targetSkills = ['embeddings', 'vector db', 'pinecone', 'weaviate', 'qdrant', 'milvus', 'opensearch', 'elasticsearch', 'faiss', 'python', 'ndcg', 'mrr', 'map', 'ranking', 'retrieval', 'hybrid search'];
  let skillScoreSum = 0;
  let matchCount = 0;

  const profMultipliers: Record<string, number> = {
    expert: 1.0,
    advanced: 0.8,
    intermediate: 0.5,
    beginner: 0.25
  };

  skills.forEach((s: any) => {
    const sName = (s.name || '').toLowerCase();
    const isTarget = targetSkills.some(ts => sName.includes(ts));

    if (isTarget) {
      matchCount++;
      const mult = profMultipliers[s.proficiency] || 0.25;
      const endorsements = s.endorsements || 0;
      const dur = s.duration_months || 0;
      
      let skillVal = dur * mult * Math.log1p(endorsements);

      // Cross-check against redrob_signals assessment scores
      const assessmentScores = signals.skill_assessment_scores || {};
      // Find matching assessment score key
      const assessKey = Object.keys(assessmentScores).find(k => sName.includes(k.toLowerCase()) || k.toLowerCase().includes(sName));
      if (assessKey !== undefined) {
        const scoreVal = assessmentScores[assessKey] || 0;
        // Expect higher assessment score for higher claimed proficiency
        const expected = s.proficiency === 'expert' ? 85 : s.proficiency === 'advanced' ? 70 : s.proficiency === 'intermediate' ? 50 : 25;
        if (scoreVal < expected - 20) {
          skillVal *= 0.4; // Big assessment gap penalty
        }
      }
      skillScoreSum += skillVal;
    }
  });

  // Normalize skill score sum. Max out around 120 points (e.g. 2 strong skills with 24 months, expert, 5 endorsements)
  let skillScore = matchCount > 0 ? Math.min(1.0, skillScoreSum / 120.0) : 0;


  // 3. EXPERIENCE BAND (0.0 to 1.0)
  const yoe = profile.years_of_experience || 0;
  // Gaussian-ish curve peaking at 7.0 yrs (soft band 5-9)
  let expScore = Math.exp(-0.5 * Math.pow((yoe - 7.0) / 2.0, 2));

  // Service company penalty (TCS, Infosys, Wipro, Accenture, Cognizant, Capgemini)
  const serviceCompanies = ['tcs', 'infosys', 'wipro', 'accenture', 'cognizant', 'capgemini'];
  const allService = history.length > 0 && history.every((job: any) => {
    const comp = (job.company || '').toLowerCase();
    return serviceCompanies.some(sc => comp.includes(sc));
  });
  if (allService) {
    expScore *= 0.25;
  }

  // Pure research / academic penalty
  const allAcademic = history.length > 0 && history.every((job: any) => {
    const title = (job.title || '').toLowerCase();
    const desc = (job.description || '').toLowerCase();
    const ind = (job.industry || '').toLowerCase();
    return ind.includes('education') || ind.includes('research') || title.includes('researcher') || title.includes('professor') || title.includes('postdoc') || desc.includes('academic');
  });
  if (allAcademic) {
    expScore *= 0.25;
  }

  // Architect/tech-lead drift (most recent role is Architect/Lead/Manager for >= 18 mos with no coding evidence)
  if (history.length > 0) {
    const recentJob = history[0];
    const title = (recentJob.title || '').toLowerCase();
    const dur = recentJob.duration_months || 0;
    const desc = (recentJob.description || '').toLowerCase();

    const isLeadTitle = ['architect', 'lead', 'manager', 'director', 'vp', 'head'].some(k => title.includes(k));
    if (isLeadTitle && dur >= 18) {
      // Check coding keywords in description
      const hasCoding = ['code', 'develop', 'program', 'python', 'write', 'implement', 'build', 'c++', 'java', 'rust', 'typescript', 'sql', 'spark', 'pytorch', 'tensorflow'].some(k => desc.includes(k));
      if (!hasCoding) {
        expScore *= 0.5;
      }
    }
  }


  // 4. LOCATION FIT (0.0 to 1.0)
  const loc = (profile.location || '').toLowerCase();
  const country = (profile.country || '').toLowerCase();
  let locScore = 0.2; // default outside India

  const isTier1 = ['pune', 'noida'].some(k => loc.includes(k));
  const isTier2 = ['hyderabad', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'ncr', 'gurgaon', 'gurugram'].some(k => loc.includes(k));
  const isIndia = country.includes('india') || ['tamil nadu', 'karnataka', 'maharashtra', 'telangana', 'haryana', 'uttar pradesh', 'delhi'].some(k => loc.includes(k));

  if (isTier1) {
    locScore = 1.0;
  } else if (isTier2) {
    locScore = 0.8;
  } else if (isIndia) {
    locScore = 0.5;
  }

  // Relocation & notice period bump for overseas/medium
  const willingToRelocate = signals.willing_to_relocate === true;
  const noticePeriod = signals.notice_period_days || 0;
  if (locScore < 0.8 && willingToRelocate && noticePeriod <= 30) {
    locScore = Math.min(0.8, locScore + 0.3);
  }


  // COMBINE FIT COMPONENTS 1-4 using slider weights
  const wSum = weights.titleFit + weights.skillDepth + weights.experienceBand + weights.locationFit;
  let baseScore = 0;
  if (wSum > 0) {
    baseScore = (
      (titleScore * weights.titleFit) +
      (skillScore * weights.skillDepth) +
      (expScore * weights.experienceBand) +
      (locScore * weights.locationFit)
    ) / wSum;
  } else {
    baseScore = (titleScore + skillScore + expScore + locScore) / 4;
  }


  // 5. BEHAVIORAL MODIFIER (multiplier)
  const responseRate = signals.recruiter_response_rate || 0;
  const interviewCompletion = signals.interview_completion_rate || 0;
  const openToWork = signals.open_to_work_flag === true;
  
  // Activity decay
  let activeDecay = 1.0;
  const lastActiveStr = signals.last_active_date;
  if (lastActiveStr) {
    const lastActive = new Date(lastActiveStr);
    const refDate = new Date(2026, 5, 25); // June 25, 2026
    const diffDays = Math.max(0, (refDate.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
    activeDecay = Math.exp(-diffDays / 180.0); // 6 months half life decay
  }

  // Notice period factor
  const noticeDays = signals.notice_period_days || 0;
  const noticeFactor = noticeDays <= 30 ? 1.0 : noticeDays <= 90 ? 0.75 : 0.4;

  const behavioralBase = (responseRate * 0.25) +
                         (activeDecay * 0.25) +
                         (interviewCompletion * 0.2) +
                         (openToWork ? 0.15 : 0.05) +
                         (noticeFactor * 0.15);

  const rawModifier = 0.5 + 0.6 * behavioralBase; // range [0.5, 1.1]

  // Apply slider weight to behavioral modifier
  const behavioralModifier = 1.0 + (rawModifier - 1.0) * (weights.behavioralSignal / 100.0);

  const finalScore = baseScore * behavioralModifier;
  return Math.min(1.0, Math.max(0.0, finalScore));
}

/**
 * Generates the factual 1-2 sentence reasoning string based on candidate profile.
 */
export function generateReasoning(candidate: any, score: number, weights: ScoringWeights): string {
  const raw = candidate.raw || candidate;
  if (!raw) return 'No data available.';

  const hpCheck = detectHoneypot(raw);
  if (hpCheck.isHoneypot) {
    return hpCheck.reason;
  }

  const profile = raw.profile || {};
  const currentTitle = profile.current_title || 'Engineer';
  const yearsExp = profile.years_of_experience || 0;
  const location = profile.location || 'Unknown';
  
  // Find key driving skill
  const targetSkills = ['embeddings', 'vector db', 'pinecone', 'weaviate', 'qdrant', 'milvus', 'opensearch', 'elasticsearch', 'faiss', 'python', 'ndcg', 'mrr', 'map', 'ranking', 'retrieval'];
  const skills = raw.skills || [];
  let bestSkill = '';
  let bestSkillDur = 0;

  skills.forEach((s: any) => {
    const sName = (s.name || '').toLowerCase();
    const isTarget = targetSkills.some(ts => sName.includes(ts));
    if (isTarget) {
      const dur = s.duration_months || 0;
      if (dur > bestSkillDur) {
        bestSkillDur = dur;
        bestSkill = s.name;
      }
    }
  });

  const skillStr = bestSkill ? `; strong in ${bestSkill} (${bestSkillDur} mos)` : '';
  const responseRate = Math.round((raw.redrob_signals?.recruiter_response_rate || 0) * 100);

  return `${currentTitle} in ${location} with ${yearsExp} yrs exp${skillStr}; recruiter response rate ${responseRate}%.`;
}
