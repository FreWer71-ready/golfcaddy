/**
 * Golf Caddy Data Models
 * Strict TypeScript types for round management, scoring, and statistics
 */

// ============================================================================
// Primitive Types
// ============================================================================

export type HoleCount = 9 | 18;

export type FairwayResult =
  | "hit"
  | "miss_left"
  | "miss_right"
  | "miss_short"
  | "miss_long"
  | "not_applicable"
  | null;

export type GreenResult =
  | "hit"
  | "miss_left"
  | "miss_right"
  | "miss_short"
  | "miss_long"
  | null;

export type RoundStatus = "draft" | "completed";

export type DataCompleteness = "round_only" | "hole_scores" | "detailed_holes";

// ============================================================================
// Player & Course Models
// ============================================================================

export interface PlayerProfile {
  playerId: string;
  name: string;
  homeClub?: string;
  currentHandicap?: number;
}

export interface Course {
  id: string;
  name: string;
  clubName?: string;
  country?: string;
  holeCount: HoleCount;
  tees: Tee[];
  holes: CourseHole[];
}

export interface Tee {
  id: string;
  name: string;
  color?: string;
  genderCategory?: string;
  courseRating?: number;
  slopeRating?: number;
}

export interface CourseHole {
  number: number;
  par: 3 | 4 | 5 | 6;
  handicapIndex?: number;
  lengths: Record<string, number | null>;
}

// ============================================================================
// Round & Hole Models
// ============================================================================

export interface PlayedHole {
  holeNumber: number;
  par: number;
  length?: number | null;
  strokeIndex?: number | null;

  score: number | null;
  putts: number | null;

  teeClubId?: string | null;
  teeClubName?: string | null;

  fairwayResult: FairwayResult;
  greenResult: GreenResult;

  penaltyStrokes: number;
  bunkerShots: number | null;

  stablefordPoints?: number | null;
  notes?: string;
}

export interface Round {
  id: string;
  schemaVersion: 1;
  playerId: string;
  status: RoundStatus;
  date: string;
  startTime?: string;
  courseId: string;
  courseNameSnapshot: string;
  teeId: string;
  teeNameSnapshot: string;
  numberOfHoles: HoleCount;
  startingHole: number;
  playingHandicap?: number;
  notes?: string;
  dataCompleteness: DataCompleteness;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  holes: PlayedHole[];
}

// ============================================================================
// Statistics Models
// ============================================================================

export interface TeeClubStatistics {
  clubId?: string;
  clubName: string;
  timesUsed: number;
  averageScore: number | null;
  averageToPar: number | null;
  fairwayEligibleSamples: number;
  fairwayHitCount: number;
  fairwayHitPercentage: number | null;
  parOrBetterCount: number;
  parOrBetterPercentage: number | null;
}

export interface RecentHoleResult {
  roundId: string;
  date: string;
  score: number;
  toPar: number;
  putts: number | null;
  teeClubName?: string | null;
  fairwayResult: FairwayResult;
  greenResult: GreenResult;
}

export interface HoleStatistics {
  courseId: string;
  courseName: string;
  teeId?: string;
  holeNumber: number;
  par: number;

  completedSamples: number;

  averageScore: number | null;
  averageToPar: number | null;
  bestScore: number | null;
  worstScore: number | null;

  parOrBetterCount: number;
  bogeyCount: number;
  doubleBogeyOrWorseCount: number;

  parOrBetterPercentage: number | null;
  bogeyPercentage: number | null;
  doubleBogeyOrWorsePercentage: number | null;

  averagePutts: number | null;
  threePuttCount: number;
  threePuttPercentage: number | null;

  fairwayEligibleSamples: number;
  fairwayHitCount: number;
  fairwayHitPercentage: number | null;

  girEligibleSamples: number;
  girCount: number;
  girPercentage: number | null;

  penaltyStrokesTotal: number;
  averagePenaltyStrokes: number | null;

  teeClubStatistics: TeeClubStatistics[];
  recentResults: RecentHoleResult[];
}

export interface RoundSummary {
  roundId: string;
  totalScore: number;
  totalPar: number;
  scoreToPar: number;
  completedHoles: number;
  totalPutts: number | null;
  fairwayHitPercentage: number | null;
  girPercentage: number | null;
  totalPenaltyStrokes: number;
}

// ============================================================================
// Import Result Models
// ============================================================================

export interface ImportError {
  index: number;
  roundId?: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  failed: number;
  errors: ImportError[];
}

// ============================================================================
// Data Container Models (for JSON files)
// ============================================================================

export interface CoursesData {
  schemaVersion: 1;
  courses: Course[];
}

export interface RoundsData {
  schemaVersion: 1;
  rounds: Round[];
}
