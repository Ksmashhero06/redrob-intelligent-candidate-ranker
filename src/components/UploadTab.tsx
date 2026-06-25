import React, { useState, useRef, useCallback } from 'react';
import { Candidate } from '../types';
import { parseCandidatesFile } from '../utils/parser';
import { SAMPLE_JSON_ARRAY, SAMPLE_JSONL_DATA } from '../utils/sampleData';
import { 
  UploadCloud, 
  AlertCircle, 
  CheckCircle2, 
  Trash2, 
  Code, 
  ChevronRight, 
  ChevronDown, 
  FileCode, 
  FileSpreadsheet, 
  Database 
} from 'lucide-react';

interface UploadTabProps {
  candidates: Candidate[];
  onCandidatesParsed: (candidates: Candidate[]) => void;
  onClearCandidates: () => void;
  onRankCandidates: () => void;
}

export default function UploadTab({ 
  candidates, 
  onCandidatesParsed, 
  onClearCandidates,
  onRankCandidates
}: UploadTabProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFileContent = useCallback((text: string, fileName: string) => {
    try {
      setError(null);
      setSuccessMessage(null);
      const parsed = parseCandidatesFile(text);
      if (parsed.length === 0) {
        throw new Error("No valid candidate profiles could be extracted. Please check the JSON/JSONL format.");
      }
      onCandidatesParsed(parsed);
      setSuccessMessage(`Successfully parsed ${parsed.length} candidate record${parsed.length === 1 ? '' : 's'} from "${fileName}"`);
    } catch (err: any) {
      setError(err.message || "Failed to parse file. Ensure it is a valid JSON array or Newline-delimited JSON (JSONL) file.");
    }
  }, [onCandidatesParsed]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processFileContent(text, file.name);
    };
    reader.onerror = () => {
      setError("Error reading the file. Please try again.");
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setError(null);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const fileName = file.name;
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (extension !== 'json' && extension !== 'jsonl') {
      setError("Invalid file type. Only .json and .jsonl files are accepted.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      processFileContent(text, fileName);
    };
    reader.onerror = () => {
      setError("Error reading the dropped file.");
    };
    reader.readAsText(file);
  };

  const handleLoadSampleArray = () => {
    const content = JSON.stringify(SAMPLE_JSON_ARRAY, null, 2);
    processFileContent(content, "sample_candidates_array.json");
  };

  const handleLoadSampleJsonl = () => {
    processFileContent(SAMPLE_JSONL_DATA, "sample_candidates.jsonl");
  };

  const toggleRowExpand = (id: string) => {
    setExpandedRow(prev => prev === id ? null : id);
  };

  const displayedCandidates = candidates.slice(0, 50);

  return (
    <div className="space-y-6" id="upload-tab-container">
      {/* Upload Zone & Quick Sample Triggers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div
            id="drag-drop-zone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed transition-all duration-150 cursor-pointer rounded-none ${
              isDragging
                ? "border-[#1A1A1A] bg-[#F9FAFB]"
                : "border-[#D1D5DB] bg-white hover:bg-zinc-50"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json,.jsonl"
              className="hidden"
            />
            <UploadCloud className="w-8 h-8 text-[#9CA3AF] mb-2 stroke-[1.5]" />
            <p className="text-xs font-medium text-[#374151]">
              Drag and drop <code className="bg-zinc-100 px-1 rounded-xs font-mono text-[11px] text-[#1A1A1A]">.json</code> or <code className="bg-zinc-100 px-1 rounded-xs font-mono text-[11px] text-[#1A1A1A]">.jsonl</code> files
            </p>
            <p className="text-[10px] text-[#9CA3AF] mt-1">
              Files are parsed client-side only
            </p>
          </div>
        </div>

        {/* Action Panel for Preloaded Datasets */}
        <div className="border border-[#E5E5E5] bg-white p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Database className="w-3.5 h-3.5 text-zinc-700" />
              <h3 className="text-[11px] font-bold text-[#1A1A1A] uppercase tracking-wider">Quick Sandbox</h3>
            </div>
            <p className="text-[11px] text-[#717171] mb-3 leading-relaxed">
              Instantiate the client parser instantly with one of our pre-formatted schemas:
            </p>
            <div className="space-y-2">
              <button
                id="load-sample-array-btn"
                onClick={handleLoadSampleArray}
                className="w-full flex items-center justify-between p-2 text-left border border-zinc-250 bg-white hover:bg-[#FBFBFA] transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-900" />
                  <div>
                    <div className="text-xs font-medium text-[#1A1A1A]">Standard JSON Array</div>
                    <div className="text-[9px] text-[#717171]">Nested profile fields, 7 records</div>
                  </div>
                </div>
                <span className="text-[9px] font-mono font-bold text-zinc-400 group-hover:text-zinc-800">LOAD</span>
              </button>

              <button
                id="load-sample-jsonl-btn"
                onClick={handleLoadSampleJsonl}
                className="w-full flex items-center justify-between p-2 text-left border border-zinc-250 bg-white hover:bg-[#FBFBFA] transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-900" />
                  <div>
                    <div className="text-xs font-medium text-[#1A1A1A]">Newline-Delimited JSONL</div>
                    <div className="text-[9px] text-[#717171]">Streaming format, 5 records</div>
                  </div>
                </div>
                <span className="text-[9px] font-mono font-bold text-zinc-400 group-hover:text-zinc-800">LOAD</span>
              </button>
            </div>
          </div>

          {candidates.length > 0 && (
            <div className="pt-3 border-t border-[#E5E5E5] mt-3 flex justify-between items-center">
              <span className="text-[10px] text-[#717171] font-medium">Reset Terminal:</span>
              <button
                id="clear-data-btn"
                onClick={onClearCandidates}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100/50 border border-red-200/50 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                Clear Records
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div id="upload-error-banner" className="flex items-start gap-2.5 p-3 bg-red-50/50 border border-red-200 text-red-800 text-xs">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Parsing Error</span>
            <p className="text-red-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {successMessage && !error && (
        <div id="upload-success-banner" className="flex items-start gap-2.5 p-3 bg-zinc-50 border border-[#E5E5E5] text-[#1A1A1A] text-xs">
          <CheckCircle2 className="w-4 h-4 text-zinc-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-[#1A1A1A]">Data Loaded Successfully</span>
            <p className="text-[#717171] mt-0.5">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Preview Table Section */}
      <div className="border border-[#E5E5E5] bg-white shadow-xs" id="preview-table-section">
        <div className="flex items-center justify-between px-4 py-2 bg-[#F9FAFB] border-b border-[#E5E5E5]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-[#374151] uppercase tracking-wider">
              Parsed Candidates
            </span>
            {candidates.length > 0 ? (
              <span className="bg-zinc-200 text-[#4B5563] text-[10px] px-1.5 py-0.5 font-medium">
                {displayedCandidates.length} of {candidates.length} records
              </span>
            ) : (
              <span className="bg-zinc-100 text-[#6B7280] text-[10px] px-1.5 py-0.5 font-medium">
                0 records
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {candidates.length > 0 && (
              <>
                <button 
                  id="rank-candidates-btn"
                  onClick={onRankCandidates}
                  className="px-2.5 py-0.5 text-[11px] bg-[#1A1A1A] hover:bg-zinc-800 text-white font-medium cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  Rank Candidates
                </button>
                <button 
                  id="clear-table-btn"
                  onClick={onClearCandidates}
                  className="px-2 py-0.5 text-[11px] bg-white border border-zinc-300 hover:bg-zinc-50 cursor-pointer text-[#1A1A1A]"
                >
                  Clear Table
                </button>
              </>
            )}
          </div>
        </div>

        {candidates.length > 0 ? (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left table-fixed min-w-[700px]" id="candidate-preview-table">
                <thead className="sticky top-0 bg-[#F9FAFB] border-b border-[#E5E5E5] z-10">
                  <tr className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider">
                    <th className="py-2 px-4 w-[5%] border-r border-[#E5E5E5]"></th>
                    <th className="py-2 px-4 w-[18%] border-r border-[#E5E5E5]">candidate_id</th>
                    <th className="py-2 px-4 w-[25%] border-r border-[#E5E5E5]">name</th>
                    <th className="py-2 px-4 w-[27%] border-r border-[#E5E5E5]">title</th>
                    <th className="py-2 px-4 w-[12%] text-right border-r border-[#E5E5E5]">years_experience</th>
                    <th className="py-2 px-4 w-[13%]">location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6] text-xs text-[#1A1A1A]">
                  {displayedCandidates.map((c, idx) => {
                    const isExpanded = expandedRow === c.candidate_id;
                    const isEven = idx % 2 === 1;
                    return (
                      <React.Fragment key={c.candidate_id}>
                        <tr 
                          onClick={() => toggleRowExpand(c.candidate_id)}
                          className={`hover:bg-zinc-50 transition-colors cursor-pointer ${
                            isExpanded ? 'bg-zinc-100/50' : isEven ? 'bg-[#FCFCFD]' : 'bg-white'
                          }`}
                        >
                          <td className="py-2 px-4 text-center border-r border-[#E5E5E5]">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 inline-block" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-zinc-400 inline-block" />
                            )}
                          </td>
                          <td className="py-2 px-4 font-mono text-[10px] text-zinc-500 border-r border-[#E5E5E5] truncate select-all">
                            {c.candidate_id}
                          </td>
                          <td className="py-2 px-4 font-medium text-[#1A1A1A] border-r border-[#E5E5E5] truncate">
                            {c.name}
                          </td>
                          <td className="py-2 px-4 text-zinc-700 border-r border-[#E5E5E5] truncate">
                            {c.title}
                          </td>
                          <td className="py-2 px-4 text-right font-mono text-[10px] text-zinc-600 border-r border-[#E5E5E5]">
                            {typeof c.years_experience === 'number' 
                              ? c.years_experience
                              : c.years_experience
                            }
                          </td>
                          <td className="py-2 px-4 text-zinc-500 truncate">
                            {c.location}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-zinc-50/50" id={`raw-inspect-${c.candidate_id}`}>
                            <td colSpan={6} className="py-3 px-6 border-t border-b border-[#E5E5E5]">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1 text-[10px] text-[#717171] uppercase tracking-wider font-bold">
                                  <Code className="w-3.5 h-3.5 text-[#717171]" />
                                  Original Raw Candidate Payload Schema (Resolved Mapping Diagnostics)
                                </div>
                                <pre className="bg-[#1A1A1A] text-zinc-100 p-3.5 font-mono text-[10px] leading-relaxed overflow-x-auto select-all max-h-[250px] border border-zinc-950">
                                  {JSON.stringify(c.raw, null, 2)}
                                </pre>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <footer className="px-4 py-2 border-t border-[#E5E5E5] bg-[#F9FAFB] flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button className="px-2 py-0.5 border border-zinc-300 text-[10px] bg-white disabled:opacity-50" disabled>Prev</button>
                <button className="px-2 py-0.5 border border-zinc-300 text-[10px] bg-white disabled:opacity-50" disabled>Next</button>
              </div>
              <span className="text-[10px] text-[#6B7280]">
                Rows 1-{displayedCandidates.length} of {candidates.length}
              </span>
            </footer>
          </div>
        ) : (
          <div className="py-12 text-center text-zinc-400 flex flex-col items-center justify-center space-y-2 bg-[#FCFCFD]">
            <FileCode className="w-8 h-8 text-zinc-300 stroke-[1.25]" />
            <div className="text-xs font-bold text-[#1A1A1A] uppercase tracking-wider">No database loaded yet</div>
            <p className="text-[10px] text-[#717171] max-w-xs leading-normal">
              Drop a .json or .jsonl file, or trigger one of the Quick Sandbox options above to instantly see mapped candidate preview tables.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
