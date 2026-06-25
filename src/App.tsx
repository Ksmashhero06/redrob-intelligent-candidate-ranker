import { useState } from 'react';
import { Candidate, TabType, ScoringWeights, RankedCandidate, computeScore } from './types';
import { generateReasoning } from './utils/scoring';
import UploadTab from './components/UploadTab';
import ResultsTab from './components/ResultsTab';
import { 
  Briefcase, 
  Upload, 
  BarChart2, 
  SlidersHorizontal
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('upload');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rankedCandidates, setRankedCandidates] = useState<RankedCandidate[]>([]);
  const [weights, setWeights] = useState<ScoringWeights>({
    titleFit: 50,
    skillDepth: 50,
    experienceBand: 50,
    locationFit: 50,
    behavioralSignal: 50,
  });

  const handleCandidatesParsed = (newCandidates: Candidate[]) => {
    setCandidates(newCandidates);
  };

  const handleClearCandidates = () => {
    setCandidates([]);
    setRankedCandidates([]);
  };

  const handleWeightChange = (key: keyof ScoringWeights, value: number) => {
    setWeights(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleRankCandidates = () => {
    if (candidates.length === 0) return;

    // Run computeScore(candidate, weights) for each candidate
    const scored = candidates.map(c => {
      const { isHoneypot, reason: honeypotReason } = detectHoneypot(c.raw);
      const score = computeScore(c, weights);
      const reasoning = generateReasoning(c, score, weights);
      return {
        ...c,
        score,
        reasoning,
        rank: 0,
        isHoneypot,
        honeypotReason,
      };
    });

    // Sort descending by score, tie-break by candidate_id ascending
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.candidate_id.localeCompare(b.candidate_id);
    });

    // Assign rank 1..N
    const ranked = scored.map((item, idx) => ({
      ...item,
      rank: idx + 1
    }));

    setRankedCandidates(ranked);
    setActiveTab('results');
  };

  return (
    <div className="min-h-screen bg-[#FBFBFA] text-[#1A1A1A] font-sans flex flex-col selection:bg-zinc-200 selection:text-zinc-900">
      {/* Top Navigation Bar in High Density Theme */}
      <header className="flex items-center justify-between px-4 sm:px-6 h-12 bg-white border-b border-[#E5E5E5] shrink-0 sticky top-0 z-30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-[#1A1A1A] flex items-center justify-center text-[10px] text-white font-bold">CR</div>
            <span className="font-semibold text-sm tracking-tight text-[#1A1A1A]">Candidate Ranker</span>
          </div>
          <nav className="flex gap-1 h-12 items-center" id="app-navigation-tabs">
            <button
              id="tab-btn-upload"
              onClick={() => setActiveTab('upload')}
              className={`h-full px-3 flex items-center gap-2 border-b-2 text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'upload'
                  ? 'border-[#1A1A1A] text-[#1A1A1A]'
                  : 'border-transparent text-[#717171] hover:text-[#1A1A1A]'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload</span>
              {candidates.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-[#1A1A1A] text-white text-[9px] font-mono font-medium">
                  {candidates.length}
                </span>
              )}
            </button>
            <button
              id="tab-btn-results"
              onClick={() => setActiveTab('results')}
              className={`h-full px-3 flex items-center gap-2 border-b-2 text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'results'
                  ? 'border-[#1A1A1A] text-[#1A1A1A]'
                  : 'border-transparent text-[#717171] hover:text-[#1A1A1A]'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Results</span>
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-[#717171] bg-[#FBFBFA] border border-[#E5E5E5] px-2 py-0.5">
            <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
            LOCAL SECURE MODE
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Sidebar: Scoring Weights */}
          <aside className="lg:col-span-1 border border-[#E5E5E5] bg-white p-4 flex flex-col gap-5 h-fit shadow-xs" id="scoring-weights-sidebar">
            <div>
              <div className="flex items-center gap-1.5 mb-1 text-xs font-bold text-[#1A1A1A] uppercase tracking-wider">
                <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-700" />
                Scoring Weights
              </div>
              <p className="text-[10px] text-[#717171] leading-relaxed">
                Adjust coefficient sliders to recalibrate candidate ranking scores dynamically in the pipeline.
              </p>
            </div>

            <div className="space-y-4">
              {/* Title Fit */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-[#1A1A1A]">
                  <span>Title Fit</span>
                  <span className="font-mono bg-zinc-100 border border-zinc-200 px-1 py-0.2 text-[10px] text-zinc-705 font-semibold">{weights.titleFit}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={weights.titleFit}
                  onChange={(e) => handleWeightChange('titleFit', parseInt(e.target.value, 10))}
                  className="w-full accent-[#1A1A1A] bg-zinc-200 h-1 rounded-none appearance-none cursor-pointer"
                />
              </div>

              {/* Skill Depth */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-[#1A1A1A]">
                  <span>Skill Depth</span>
                  <span className="font-mono bg-zinc-100 border border-zinc-200 px-1 py-0.2 text-[10px] text-zinc-705 font-semibold">{weights.skillDepth}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={weights.skillDepth}
                  onChange={(e) => handleWeightChange('skillDepth', parseInt(e.target.value, 10))}
                  className="w-full accent-[#1A1A1A] bg-zinc-200 h-1 rounded-none appearance-none cursor-pointer"
                />
              </div>

              {/* Experience Band */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-[#1A1A1A]">
                  <span>Experience Band</span>
                  <span className="font-mono bg-zinc-100 border border-zinc-200 px-1 py-0.2 text-[10px] text-zinc-705 font-semibold">{weights.experienceBand}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={weights.experienceBand}
                  onChange={(e) => handleWeightChange('experienceBand', parseInt(e.target.value, 10))}
                  className="w-full accent-[#1A1A1A] bg-zinc-200 h-1 rounded-none appearance-none cursor-pointer"
                />
              </div>

              {/* Location Fit */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-[#1A1A1A]">
                  <span>Location Fit</span>
                  <span className="font-mono bg-zinc-100 border border-zinc-200 px-1 py-0.2 text-[10px] text-zinc-705 font-semibold">{weights.locationFit}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={weights.locationFit}
                  onChange={(e) => handleWeightChange('locationFit', parseInt(e.target.value, 10))}
                  className="w-full accent-[#1A1A1A] bg-zinc-200 h-1 rounded-none appearance-none cursor-pointer"
                />
              </div>

              {/* Behavioral Signal */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-[#1A1A1A]">
                  <span>Behavioral Signal</span>
                  <span className="font-mono bg-zinc-100 border border-zinc-200 px-1 py-0.2 text-[10px] text-zinc-705 font-semibold">{weights.behavioralSignal}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={weights.behavioralSignal}
                  onChange={(e) => handleWeightChange('behavioralSignal', parseInt(e.target.value, 10))}
                  className="w-full accent-[#1A1A1A] bg-zinc-200 h-1 rounded-none appearance-none cursor-pointer"
                />
              </div>
            </div>
          </aside>

          {/* Tab Pages Workspace Area */}
          <div className="lg:col-span-3">
            {activeTab === 'upload' ? (
              <div className="flex flex-col gap-6">
                {/* Header section explaining the tool */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#E5E5E5] pb-4">
                  <div>
                    <h1 className="text-base font-bold text-[#1A1A1A] tracking-tight">
                      Candidate Ingestion Terminal
                    </h1>
                    <p className="text-[11px] text-[#717171] mt-0.5 max-w-2xl leading-relaxed">
                      Upload raw profile records client-side. The local engine normalizes heterogeneous structures like <code className="text-[10px] bg-zinc-150 font-mono text-zinc-800 px-1 py-0.5">profile.anonymized_name</code> dynamically.
                    </p>
                  </div>
                </div>

                <UploadTab 
                  candidates={candidates}
                  onCandidatesParsed={handleCandidatesParsed}
                  onClearCandidates={handleClearCandidates}
                  onRankCandidates={handleRankCandidates}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-6" id="results-tab-container">
                {/* Header section */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#E5E5E5] pb-4">
                  <div>
                    <h1 className="text-base font-bold text-[#1A1A1A] tracking-tight">
                      Downstream Scoring &amp; Rankings
                    </h1>
                    <p className="text-[11px] text-[#717171] mt-0.5 max-w-2xl leading-relaxed">
                      Analyze model ranking outputs and scoring weights calibration instantly.
                    </p>
                  </div>
                </div>

                {rankedCandidates.length > 0 ? (
                  <ResultsTab 
                    rankedCandidates={rankedCandidates}
                    onClearCandidates={handleClearCandidates}
                  />
                ) : (
                  /* Placeholder container */
                  <div className="border border-[#E5E5E5] bg-white p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                    <div className="p-3 bg-[#FBFBFA] border border-[#E5E5E5] text-zinc-400 mb-4">
                      <SlidersHorizontal className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
                    </div>
                    <h3 className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wider mb-1">
                      Downstream pipeline inactive
                    </h3>
                    <p className="text-xs text-[#717171] max-w-md leading-relaxed mb-5">
                      No scored records available. Ingest candidate files or load standard pre-formatted data, then click "Rank Candidates" to trigger scoring.
                    </p>
                    <button
                      id="return-upload-tab-btn"
                      onClick={() => setActiveTab('upload')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1A1A1A] border border-zinc-300 bg-white hover:bg-[#FBFBFA] hover:border-zinc-400 transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Go to Ingestion Terminal
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Aesthetic Developer Footer */}
      <footer className="border-t border-[#E5E5E5] bg-white py-3 text-[#717171]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#717171]">
            <SlidersHorizontal className="w-3 h-3 text-[#717171]" />
            <span>Candidate Ranker Engine &bull; Client Parser Engine v1.0.0</span>
          </div>
          <div className="text-[10px] font-mono text-[#717171] text-center sm:text-right">
            Zero telemetry logs active &bull; Privacy preserved client-side
          </div>
        </div>
      </footer>
    </div>
  );
}
