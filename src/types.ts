export interface Candidate {
  candidate_id: string;
  name: string;
  title: string;
  years_experience: number | string;
  location: string;
  raw: any;
}

export type TabType = 'upload' | 'results';

export interface ScoringWeights {
  titleFit: number;
  skillDepth: number;
  experienceBand: number;
  locationFit: number;
  behavioralSignal: number;
}

export interface RankedCandidate extends Candidate {
  rank: number;
  score: number;
  reasoning: string;
}

// TODO: replace with real scoring logic
export function computeScore(candidate: Candidate, weights: ScoringWeights): number {
  return Math.random();
}

