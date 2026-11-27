import type { TournamentVariantName } from "../interfaces/tournament.ts";

export const TOURNAMENT_ITERATIONS = 10000;

export const TOURNAMENT_RUNS = 5;

export const TOURNAMENT_DEOPT_PENALTY = 50;

export const TOURNAMENT_TIE_ORDER: TournamentVariantName[] = ["readable", "first", "optimized"];

export const TOURNAMENT_TIMEOUT_MILLISECONDS = 20000;
