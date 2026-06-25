import React, { useState, useMemo } from 'react';
import { RankedCandidate } from '../types';
import { 
  Search, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  AlertTriangle, 
  FileCheck, 
  Database,
  Download,
  Info
} from 'lucide-react';

interface ResultsTabProps {
  rankedCandidates: RankedCandidate[];
  onClearCandidates: () => void;
}

type SortField = 'rank' | 'candidate_id' | 'score';
type SortOrder = 'asc' | 'desc';

export default function ResultsTab({ 
  rankedCandidates, 
  onClearCandidates 
}: ResultsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('rank');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const filteredAndSortedCandidates = useMemo(() => {
    let result = [...rankedCandidates];

    // Text filter by candidate_id, name, or reasoning
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(c =>
        c.candidate_id.toLowerCase().includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.reasoning || '').toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (sortField === 'candidate_id') {
        valA = String(valA);
        valB = String(valB);
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else {
        // numeric fields (rank, score)
        const numA = Number(valA);
        const numB = Number(valB);
        return sortOrder === 'asc' ? numA - numB : numB - numA;
      }
    });

    return result;
  }, [rankedCandidates, searchQuery, sortField, sortOrder]);

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-zinc-400" />;
    }
    return sortOrder === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-zinc-900" /> 
      : <ArrowDown className="w-3 h-3 text-zinc-900" />;
  };

  // Export helper for currently filtered/sorted rows matching exact columns: candidate_id, rank, score, reasoning
  const handleExportCSV = () => {
    if (filteredAndSortedCandidates.length === 0) return;
    
    const headers = ['candidate_id', 'rank', 'score', 'reasoning'];
    const rows = filteredAndSortedCandidates.map(c => [
      `"${c.candidate_id.replace(/"/g, '""')}"`,
      c.rank,
      c.score.toFixed(4),
      `"${c.reasoning.replace(/"/g, '""')}"`
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `ranked_candidates_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6" id="results-workspace">
      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white border border-[#E5E5E5] p-3 shadow-xs">
        {/* Search Input */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
          <input
            id="candidate-id-search"
            type="text"
            placeholder="Filter by ID, name, or reasoning..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-zinc-300 bg-white placeholder-zinc-400 focus:outline-hidden focus:border-zinc-800 focus:ring-0 rounded-none text-zinc-900"
          />
        </div>

        {/* Action triggers */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {rankedCandidates.length > 0 && (
            <>
              <button
                id="download-csv-btn"
                onClick={handleExportCSV}
                className="px-2.5 py-1.5 text-xs font-medium text-zinc-850 bg-white border border-zinc-300 hover:bg-zinc-50 cursor-pointer flex items-center gap-1.5 rounded-none"
              >
                <Download className="w-3.5 h-3.5 text-zinc-650" />
                Download CSV
              </button>
              <button
                id="results-clear-btn"
                onClick={onClearCandidates}
                className="px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100/50 border border-red-200/50 cursor-pointer rounded-none"
              >
                Clear Rankings
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Table section */}
      <div className="border border-[#E5E5E5] bg-white shadow-xs" id="results-table-section">
        <div className="flex items-center justify-between px-4 py-2 bg-[#F9FAFB] border-b border-[#E5E5E5]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[#374151] uppercase tracking-wider">
              Scoring Outputs
            </span>
            <span className="bg-[#1A1A1A] text-white text-[10px] px-1.5 py-0.5 font-mono font-medium">
              Sorted by Match Score Descending
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-zinc-400">
              Total ranked: {rankedCandidates.length}
            </span>
          </div>
        </div>

        {filteredAndSortedCandidates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left table-fixed min-w-[800px]" id="results-table">
              <thead className="sticky top-0 bg-[#F9FAFB] border-b border-[#E5E5E5] z-10">
                <tr className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider select-none">
                  {/* Rank Header */}
                  <th 
                    onClick={() => handleSort('rank')}
                    className="py-2 px-4 w-[10%] border-r border-[#E5E5E5] hover:bg-zinc-100/85 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span>rank</span>
                      {renderSortIndicator('rank')}
                    </div>
                  </th>
                  {/* Candidate ID Header */}
                  <th 
                    onClick={() => handleSort('candidate_id')}
                    className="py-2 px-4 w-[20%] border-r border-[#E5E5E5] hover:bg-zinc-100/85 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span>candidate_id</span>
                      {renderSortIndicator('candidate_id')}
                    </div>
                  </th>
                  {/* Score Header */}
                  <th 
                    onClick={() => handleSort('score')}
                    className="py-2 px-4 w-[25%] border-r border-[#E5E5E5] hover:bg-zinc-100/85 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span>score (0.0 - 1.0)</span>
                      {renderSortIndicator('score')}
                    </div>
                  </th>
                  {/* Reasoning Header */}
                  <th className="py-2 px-4 w-[30%] border-r border-[#E5E5E5]">
                    reasoning
                  </th>
                  {/* Flagged Header */}
                  <th className="py-2 px-4 w-[15%]">
                    status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6] text-xs text-[#1A1A1A]">
                {filteredAndSortedCandidates.map((c, idx) => {
                  const isEven = idx % 2 === 1;
                  const isFlagged = c.isHoneypot;

                  return (
                    <tr 
                      key={c.candidate_id} 
                      className={`hover:bg-zinc-50 transition-colors ${
                        isFlagged ? 'bg-red-50/30' : isEven ? 'bg-[#FCFCFD]' : 'bg-white'
                      }`}
                    >
                      {/* Rank */}
                      <td className="py-2 px-4 font-mono font-bold text-zinc-900 border-r border-[#E5E5E5]">
                        #{c.rank}
                      </td>
                      {/* Candidate ID */}
                      <td className="py-2 px-4 border-r border-[#E5E5E5]">
                        <div className="flex flex-col">
                          <span className="font-mono text-[10px] text-zinc-500 truncate select-all">{c.candidate_id}</span>
                          <span className="font-semibold text-zinc-900 text-[11px] truncate mt-0.5">{c.name}</span>
                        </div>
                      </td>
                      {/* Score */}
                      <td className="py-2 px-4 border-r border-[#E5E5E5]">
                        <div className="flex items-center gap-2.5">
                          {/* Percent Bar */}
                          <div className="flex-1 bg-zinc-150 h-2 border border-zinc-200">
                            <div 
                              className={`h-full transition-all duration-300 ${
                                isFlagged ? 'bg-red-400' : 'bg-zinc-900'
                              }`}
                              style={{ width: `${Math.min(100, c.score * 100)}%` }}
                            />
                          </div>
                          <span className={`font-mono text-[11px] font-bold w-10 text-right shrink-0 ${
                            isFlagged ? 'text-red-600' : 'text-zinc-800'
                          }`}>
                            {c.score.toFixed(3)}
                          </span>
                        </div>
                      </td>
                      {/* Reasoning */}
                      <td className={`py-2 px-4 border-r border-[#E5E5E5] text-[11px] truncate ${
                        isFlagged ? 'text-red-600 font-medium not-italic' : 'text-zinc-500 italic'
                      }`}>
                        {isFlagged ? c.honeypotReason.replace('HONEYPOT: ', '') : c.reasoning}
                      </td>
                      {/* Flagged Status */}
                      <td className="py-2 px-4">
                        {isFlagged ? (
                          <span 
                            title={c.honeypotReason}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-bold text-red-700 bg-red-50 border border-red-200 cursor-help"
                          >
                            <AlertTriangle className="w-2.5 h-2.5 text-red-600" />
                            HONEYPOT
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-medium text-emerald-700 bg-emerald-50 border border-emerald-200">
                            <FileCheck className="w-2.5 h-2.5 text-emerald-600" />
                            VALID
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-zinc-400 flex flex-col items-center justify-center space-y-2 bg-[#FCFCFD]">
            <Search className="w-8 h-8 text-zinc-300 stroke-[1.25]" />
            <div className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wider">No matching records</div>
            <p className="text-[10px] text-[#717171] max-w-xs leading-normal">
              Adjust your filter parameters or search terms to display scored outputs.
            </p>
          </div>
        )}

        {/* Table Footer */}
        <footer className="px-4 py-2 border-t border-[#E5E5E5] bg-[#F9FAFB] flex items-center justify-between">
          <span className="text-[10px] text-[#6B7280]">
            Displaying {filteredAndSortedCandidates.length} of {rankedCandidates.length} ranked candidates
          </span>
          {searchQuery && (
            <span className="text-[10px] text-[#6B7280] italic">
              Filtered by ID matching "{searchQuery}"
            </span>
          )}
        </footer>
      </div>

      {/* Info notice about future capabilities */}
      <div className="p-3 bg-zinc-50 border border-[#E5E5E5] flex gap-2 text-[11px] text-[#717171] leading-relaxed">
        <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-zinc-850 block mb-0.5">Scoring Model Active (Multi-Factor Alignment Engine)</span>
          Candidates were assessed against Title Fit, Skill Depth, Experience Band, Location Fit, and Behavioral Signal coefficients. To customize individual weight equations, adjust the sliders on the left panel and click <strong className="text-zinc-800">Rank Candidates</strong> in the Upload view.
        </div>
      </div>
    </div>
  );
}
