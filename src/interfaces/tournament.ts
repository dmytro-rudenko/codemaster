export type TournamentVariantName = "first" | "readable" | "optimized";

export interface TournamentMetrics {
  readability: number;
  length: number;
  bytecode: number;
  speed: number | null;
  bytecodePerToken: number;
  desugared: number;
}

export interface TournamentVariantResult {
  variant: TournamentVariantName;
  passed: boolean;
  failure: string | null;
  metrics: TournamentMetrics | null;
  score: number | null;
}

export interface TournamentResult {
  target: { file: string; functionName: string };
  variants: TournamentVariantResult[];
  winner: TournamentVariantName | "none";
}

export interface TournamentCandidate {
  file: string;
  line: number;
  functionName: string;
  complexity: number;
  lines: number;
  bodyHash: string;
}

export interface TournamentDoneEntry {
  key: string;
  bodyHash: string | null;
  skipped: boolean;
  reason: string | null;
}
