import { computeScore, detectHoneypot } from './utils/scoring';

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
  isHoneypot: boolean;
  honeypotReason: string;
}

export { computeScore, detectHoneypot };


