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

const REF_DATE = new Date(2026, 5, 25); // June 25, 2026

function isTitleNonTechnical(title: string): boolean {
  title = title.toLowerCase();
  const nonTech = ["marketing", "hr ", "human resources", "recruiter", "sales", "accountant", 
                   "operations", "graphic", "civil engineer", "mechanical engineer", "content writer"];
  return nonTech.some(kw => title.includes(kw));
}

function isJobNonTechnical(job: any): boolean {
  const title = (job.title || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  
  const nonTechTitles = ["marketing", "sales", "hr ", "human resources", "recruiter", 
                         "operations", "accounting", "accountant", "content writer", 
                         "graphic", "civil engineer", "mechanical engineer", "support", 
                         "business analyst", "project manager", "designer", "legal", 
                         "finance", "administrative"];
  const titleNonTech = nonTechTitles.some(kw => title.includes(kw));
  if (!titleNonTech) {
    return false;
  }
  
  // Check if description has technical terms
  const techWords = ["develop", "code", "programming", "software", "engineer", "ml", "ai", 
                     "data scientist", "database", "python", "java", "c++", "rust", 
                     "typescript", "golang", "backend", "frontend", "full stack", "qa", 
                     "test", "devops"];
  const descHasTech = techWords.some(w => desc.includes(w));
  
  let isFakeTech = false;
  if (descHasTech) {
    if (desc.includes("java backend development") || desc.includes("test automation and qa") || desc.includes("full-stack web application development")) {
      isFakeTech = true;
    }
  }
  
  if (!descHasTech || isFakeTech) {
    return true;
  }
  
  return false;
}

function getJobTitleBaseScore(title: string): number {
  title = title.toLowerCase();
  
  // 1. Non-technical check
  const nonTech = ["marketing", "hr ", "human resources", "recruiter", "sales", "accountant", 
                   "operations", "graphic", "civil engineer", "mechanical engineer", "content writer",
                   "support", "designer", "legal", "finance", "administrative", "project manager", "business analyst"];
  if (nonTech.some(kw => title.includes(kw))) {
    return 0.0;
  }
  
  // 2. Direct AI/ML match
  const titleKeywords = ['ranking', 'retrieval', 'search', 'recommend', 'embed', 'vector', 'ndcg', 'mrr', 'nlp', 'machine learning', 'ml engineer', 'ai engineer', 'data scientist', 'applied scientist', 'applied ml', 'applied ai', 'staff ml', 'senior ml', 'information retrieval', 'relevance', 'personalization'];
  const titleHits = titleKeywords.filter(k => title.includes(k)).length;
  if (titleHits > 0) {
    return Math.min(0.80, 0.40 + title_hits_calculation(title, titleKeywords) * 0.15);
  }
  
  // 3. General technical match
  const tech = ["software", "engineer", "developer", "programmer", "coder", "architect", 
                "lead", "scientist", "devops", "qa", "test", "web", "frontend", "backend", "fullstack", "full stack"];
  if (tech.some(kw => title.includes(kw))) {
    return 0.20;
  }
  
  return 0.05;
}

function title_hits_calculation(title: string, keywords: string[]): number {
  return keywords.filter(k => title.includes(k)).length;
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
      const company = (job.company || '').toLowerCase();

      const recencyWeight = 1.0 / (index + 1);
      const durationWeight = Math.min(60, dur) / 12.0;
      const roleImportance = recencyWeight * durationWeight;

      const baseScore = getJobTitleBaseScore(title);
      let score = 0;

      if (baseScore > 0.0) {
        const descKeywords = ['ranking', 'retrieval', 'search', 'recommend', 'embed', 'vector', 'ndcg', 'mrr', 'map', 'information retrieval', 'rerank', 'sentence transformer', 'pinecone', 'weaviate', 'qdrant', 'faiss', 'elasticsearch', 'opensearch', 'relevance', 'personalization', 'recommendation engine', 'search engine', 'candidate ranking', 'item ranking', 'hybrid search', 'dense retrieval', 'sparse retrieval', 'ltr', 'learning to rank'];
        const shippingKeywords = ['deployed', 'launched', 'shipped', 'production', 'a/b test', 'a/b testing', 'served', 'serving', 'scale', 'latency', 'throughput', 'real-time', 'online', 'live', 'rollout', 'canary', 'shadow mode', 'millions', 'billion', 'hundred million', 'daily active', 'user-facing', 'end-to-end', 'built and deployed', 'led development'];
        const systemBigrams = ['recommendation system', 'search system', 'ranking system', 'ranking pipeline', 'retrieval system', 'retrieval pipeline', 'embedding pipeline', 'search pipeline', 'matching system', 'matching engine', 'recommendation engine', 'relevance system', 'ranking engine'];

        const descMatches = descKeywords.filter(k => desc.includes(k)).length;
        const shipMatches = shippingKeywords.filter(k => desc.includes(k)).length;
        const bigramMatches = systemBigrams.filter(bg => desc.includes(bg) || title.includes(bg)).length;

        const descBonus = descMatches * 0.04 + shipMatches * 0.04 + Math.min(0.1, bigramMatches * 0.04);
        score = Math.min(1.0, baseScore + descBonus);

        const serviceCompanies = ['tcs', 'infosys', 'wipro', 'accenture', 'cognizant', 'capgemini'];
        const isService = serviceCompanies.some(sc => company.includes(sc));
        if (!isService && index < 3) {
          const compSize = job.company_size || '';
          const companySizeScore: Record<string, number> = {
            '1-10': 0.6, '11-50': 0.65, '51-200': 0.75,
            '201-500': 0.85, '501-1000': 0.9, '1001-5000': 0.95,
            '5001-10000': 1.0, '10001+': 1.0
          };
          const sizeScore = companySizeScore[compSize] || 0.7;
          score = Math.min(1.0, score + sizeScore * 0.05);
        }
      }

      weightedRoleMatches += score * roleImportance;
      roleWeightSum += roleImportance;
    });

    titleScore = roleWeightSum > 0 ? weightedRoleMatches / roleWeightSum : 0;
  }

  const curTitle = (profile.current_title || '').toLowerCase();
  if (isTitleNonTechnical(curTitle)) {
    titleScore *= 0.1;
  }
  titleScore = Math.min(1.0, Math.max(0.0, titleScore));


  // 2. SKILL DEPTH (0.0 to 1.0)
  const targetSkills = ['embeddings', 'sentence-transformers', 'sentence transformers', 'vector db', 'vector database', 'vector search', 'pinecone', 'weaviate', 'qdrant', 'milvus', 'opensearch', 'elasticsearch', 'faiss', 'annoy', 'scann', 'python', 'ndcg', 'mrr', 'map', 'ranking', 'retrieval', 'hybrid search', 'information retrieval', 'reranking', 'bi-encoder', 'cross-encoder', 'dense retrieval', 'sparse retrieval', 'bm25', 'bge', 'e5', 'learning to rank', 'ltr', 'recommendation', 'search engine'];
  let skillScoreSum = 0;

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
      const mult = profMultipliers[s.proficiency] || 0.25;
      const endorsements = s.endorsements || 0;
      const dur = s.duration_months || 0;
      
      let skillVal = dur * mult * Math.log1p(endorsements);

      // Timeline and domain relevance corroboration
      let corroborated = false;
      const skillStart = new Date(REF_DATE.getTime() - dur * 30.4 * 24 * 60 * 60 * 1000);
      
      for (const job of history) {
        if (!job.start_date) continue;
        const jobStart = new Date(job.start_date);
        const jobEnd = job.end_date ? new Date(job.end_date) : REF_DATE;

        if (jobStart <= REF_DATE && jobEnd >= skillStart) {
          if (!isJobNonTechnical(job)) {
            if (sName.includes('python')) {
              corroborated = true;
              break;
            } else {
              const jobTitle = (job.title || '').toLowerCase();
              const jobDesc = (job.description || '').toLowerCase();
              
              const titleKeywords = ['ranking', 'retrieval', 'search', 'recommend', 'embed', 'vector', 'ndcg', 'mrr', 'nlp', 'machine learning'];
              const descKeywords = ['ranking', 'retrieval', 'search', 'recommend', 'embed', 'vector', 'ndcg', 'mrr', 'map'];
              const systemBigrams = ['recommendation system', 'search system', 'ranking system', 'ranking pipeline', 'retrieval system', 'retrieval pipeline', 'embedding pipeline'];
              
              const hasKw = titleKeywords.some(k => jobTitle.includes(k)) ||
                            descKeywords.some(k => jobDesc.includes(k)) ||
                            systemBigrams.some(bg => jobTitle.includes(bg) || jobDesc.includes(bg));
              if (hasKw) {
                corroborated = true;
                break;
              }
            }
          }
        }
      }

      if (!corroborated) {
        skillVal *= 0.25;
      }

      // Cross-check against assessment scores
      const assessmentScores = signals.skill_assessment_scores || {};
      const assessKey = Object.keys(assessmentScores).find(k => sName.includes(k.toLowerCase()) || k.toLowerCase().includes(sName));
      if (assessKey !== undefined) {
        const scoreVal = assessmentScores[assessKey] || 0;
        const expected = s.proficiency === 'expert' ? 85 : s.proficiency === 'advanced' ? 70 : s.proficiency === 'intermediate' ? 50 : 25;
        if (scoreVal < expected - 20) {
          skillVal *= 0.4;
        }
      }
      skillScoreSum += skillVal;
    }
  });

  let skillScore = Math.min(1.0, skillScoreSum / 120.0);

  // Special keyword-stuffer penalty (non-technical current title + 3+ AI skills)
  if (isTitleNonTechnical(curTitle)) {
    let aiSkillsCount = 0;
    skills.forEach((s: any) => {
      const sName = (s.name || '').toLowerCase();
      const isTarget = targetSkills.some(ts => sName.includes(ts) && ts !== 'python');
      if (isTarget && (s.duration_months || 0) > 12) {
        aiSkillsCount++;
      }
    });
    if (aiSkillsCount >= 3) {
      skillScore *= 0.5;
      candidate._is_keyword_stuffer = true;
    }
  }


  // 3. EXPERIENCE BAND (0.0 to 1.0)
  const yoe = profile.years_of_experience || 0;
  let expScore = Math.exp(-0.5 * Math.pow((yoe - 7.0) / 2.0, 2));

  const serviceCompanies = ['tcs', 'infosys', 'wipro', 'accenture', 'cognizant', 'capgemini'];
  const allService = history.length > 0 && history.every((job: any) => {
    const comp = (job.company || '').toLowerCase();
    return serviceCompanies.some(sc => comp.includes(sc));
  });
  if (allService) {
    expScore *= 0.25;
  }

  const allAcademic = history.length > 0 && history.every((job: any) => {
    const title = (job.title || '').toLowerCase();
    const desc = (job.description || '').toLowerCase();
    const ind = (job.industry || '').toLowerCase();
    return ind.includes('education') || ind.includes('research') || title.includes('researcher') || title.includes('professor') || title.includes('postdoc') || desc.includes('academic');
  });
  if (allAcademic) {
    expScore *= 0.25;
  }

  if (history.length > 0) {
    const recentJob = history[0];
    const title = (recentJob.title || '').toLowerCase();
    const dur = recentJob.duration_months || 0;
    const desc = (recentJob.description || '').toLowerCase();

    const isLeadTitle = ['architect', 'lead', 'manager', 'director', 'vp', 'head'].some(k => title.includes(k));
    if (isLeadTitle && dur >= 18) {
      const hasCoding = ['code', 'develop', 'program', 'python', 'write', 'implement', 'build', 'c++', 'java', 'rust', 'typescript', 'sql', 'spark', 'pytorch', 'tensorflow'].some(k => desc.includes(k));
      if (!hasCoding) {
        expScore *= 0.5;
      }
    }
  }


  // 4. LOCATION FIT (0.0 to 1.0)
  const loc = (profile.location || '').toLowerCase();
  const country = (profile.country || '').toLowerCase();
  let locScore = 0.2;

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
  
  let activeDecay = 1.0;
  const lastActiveStr = signals.last_active_date;
  if (lastActiveStr) {
    const lastActive = new Date(lastActiveStr);
    const diffDays = Math.max(0, (REF_DATE.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
    activeDecay = Math.exp(-diffDays / 180.0);
  }

  const noticeDays = signals.notice_period_days || 0;
  const noticeFactor = noticeDays <= 30 ? 1.0 : noticeDays <= 90 ? 0.75 : 0.4;

  const behavioralBase = (responseRate * 0.25) +
                         (activeDecay * 0.25) +
                         (interviewCompletion * 0.2) +
                         (openToWork ? 0.15 : 0.05) +
                         (noticeFactor * 0.15);

  const rawModifier = 0.5 + 0.6 * behavioralBase;

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
  const stufferNote = candidate._is_keyword_stuffer ? " Note: AI skills listed without corroborating technical career history." : "";

  return `${currentTitle} in ${location} with ${yearsExp} yrs exp${skillStr}; recruiter response rate ${responseRate}%.${stufferNote}`;
}
