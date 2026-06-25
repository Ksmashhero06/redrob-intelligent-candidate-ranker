import { Candidate } from '../types';

/**
 * Safely resolves nested fields in an object based on a path of string keys
 */
function getNestedValue(obj: any, path: string[]): any {
  let current = obj;
  for (const key of path) {
    if (current && typeof current === 'object' && current !== null && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

// Possible path arrays for candidate properties, sorted by descending priority/specificity
const CANDIDATE_ID_PATHS = [
  ['candidate_id'],
  ['id'],
  ['profile', 'candidate_id'],
  ['profile', 'id'],
  ['uuid'],
  ['profile', 'uuid'],
  ['key'],
];

const NAME_PATHS = [
  ['profile', 'anonymized_name'],
  ['profile', 'name'],
  ['profile', 'full_name'],
  ['profile', 'fullname'],
  ['anonymized_name'],
  ['name'],
  ['full_name'],
  ['fullname'],
  ['candidate_name'],
];

const TITLE_PATHS = [
  ['profile', 'current_title'],
  ['profile', 'title'],
  ['profile', 'role'],
  ['profile', 'position'],
  ['current_title'],
  ['title'],
  ['role'],
  ['position'],
  ['headline'],
  ['profile', 'headline'],
];

const EXPERIENCE_PATHS = [
  ['profile', 'years_of_experience'],
  ['profile', 'years_experience'],
  ['years_of_experience'],
  ['years_experience'],
  ['experience_years'],
  ['profile', 'experience_years'],
  ['experience'],
  ['profile', 'experience'],
];

const LOCATION_PATHS = [
  ['profile', 'location'],
  ['location'],
  ['profile', 'city'],
  ['city'],
  ['profile', 'address'],
  ['address'],
  ['profile', 'country'],
  ['country'],
];

/**
 * Searches the candidate object for a field using potential path keys
 */
function findValue(obj: any, paths: string[][], fallback: any): any {
  for (const path of paths) {
    const val = getNestedValue(obj, path);
    if (val !== undefined && val !== null) {
      return val;
    }
  }
  return fallback;
}

/**
 * Standardize any candidate raw object into the Candidate interface
 */
export function mapRawToCandidate(raw: any, index: number): Candidate {
  const fallbackId = `CAND-${String(index + 1).padStart(3, '0')}`;
  
  const idValue = findValue(raw, CANDIDATE_ID_PATHS, fallbackId);
  const nameValue = findValue(raw, NAME_PATHS, `Candidate ${String(index + 1).padStart(3, '0')}`);
  const titleValue = findValue(raw, TITLE_PATHS, 'Not Specified');
  const expValue = findValue(raw, EXPERIENCE_PATHS, 'N/A');
  const locValue = findValue(raw, LOCATION_PATHS, 'Not Specified');

  // Clean up experience value to be number if possible
  let experience: number | string = expValue;
  if (typeof expValue === 'string') {
    const parsed = parseFloat(expValue.replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed)) {
      experience = parsed;
    }
  } else if (typeof expValue === 'number' && !isNaN(expValue)) {
    experience = expValue;
  }

  return {
    candidate_id: String(idValue),
    name: String(nameValue),
    title: String(titleValue),
    years_experience: experience,
    location: String(locValue),
    raw,
  };
}

/**
 * Parses raw file content. Supports JSON array and JSONL formats.
 */
export function parseCandidatesFile(content: string): Candidate[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  let rawObjects: any[] = [];

  // Try standard JSON first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        rawObjects = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        // If it's a wrapper object, see if there's a list inside it
        const possibleArrays = Object.values(parsed).filter(val => Array.isArray(val));
        if (possibleArrays.length > 0) {
          // Default to the first array found (or choose the one with longest length)
          possibleArrays.sort((a: any, b: any) => b.length - a.length);
          rawObjects = possibleArrays[0];
        } else {
          // Just a single object, wrap it
          rawObjects = [parsed];
        }
      }
    } catch (e) {
      // Standard JSON parsing failed, let's fall back to JSONL
    }
  }

  // If standard JSON didn't yield an array, try JSONL
  if (rawObjects.length === 0) {
    const lines = trimmed.split(/\r?\n/);
    const parsedLines: any[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      try {
        const parsedLine = JSON.parse(line);
        if (parsedLine && typeof parsedLine === 'object') {
          parsedLines.push(parsedLine);
        }
      } catch (e) {
        // If a single line fails in standard JSONL, continue or let it go
      }
    }
    
    if (parsedLines.length > 0) {
      rawObjects = parsedLines;
    }
  }

  // Map to structured candidates
  return rawObjects.map((obj, index) => mapRawToCandidate(obj, index));
}
