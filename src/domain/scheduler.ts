import { Direction, Phase, JunctionState, VehicleType } from './types';
import { VEHICLE_WEIGHT } from './junctionConfig';

export interface QueueInfo {
  direction: Direction;
  size: number;
  weightSum: number;
  oldestWaitMs: number; // max wait time for WAITING in this direction
}

export interface PhaseScore {
  phase: Phase;
  score: number;
  hasStarved: boolean; // any vehicle waiting > MAX_WAIT_MS
}

function nowMs(date: Date): number {
  return date.getTime();
}

export function scorePhase(state: JunctionState, phase: Phase, now: Date, queues: QueueInfo[]): PhaseScore {
  const t = state.config.timings;
  const dirs = getDirectionsForPhase(phase);
  let score = 0;
  let hasStarved = false;
  for (const d of dirs) {
    const q = queues.find((x) => x.direction === d);
    if (!q) continue;
    score += q.size * 1;
    score += q.weightSum;
    score += (q.oldestWaitMs / 1000.0) * 0.5;
    if (q.oldestWaitMs > t.MAX_WAIT_MS) {
      hasStarved = true;
    }
  }
  return { phase, score, hasStarved };
}

function getDirectionsForPhase(phase: Phase): Direction[] {
  if (phase === 'NS_GREEN' || phase === 'NS_YELLOW') return ['NORTH', 'SOUTH'];
  if (phase === 'EW_GREEN' || phase === 'EW_YELLOW') return ['EAST', 'WEST'];
  return [];
}

export function pickNextPhase(state: JunctionState, now: Date, queues: QueueInfo[]): Phase | null {
  const current = state.phase;
  const t = state.config.timings;
  const phaseStarted = state.phaseStartedAt.getTime();
  const elapsed = now.getTime() - phaseStarted;
  const inGreen = current === 'NS_GREEN' || current === 'EW_GREEN';
  const minGreenOk = elapsed >= t.MIN_GREEN_MS;

  const nsScore = scorePhase(state, 'NS_GREEN', now, queues);
  const ewScore = scorePhase(state, 'EW_GREEN', now, queues);

  const totalNs = nsScore.score;
  const totalEw = ewScore.score;
  const nsHas = nsScore.hasStarved;
  const ewHas = ewScore.hasStarved;

  // Starvation protection: if any waiting > MAX_WAIT_MS, its phase wins after MIN_GREEN_MS
  if (minGreenOk) {
    if (nsHas && !ewHas) return 'NS_GREEN';
    if (ewHas && !nsHas) return 'EW_GREEN';
    if (nsHas && ewHas) {
      // if both starved, pick higher score or keep current? prefer higher score
      if (totalEw > totalNs) return 'EW_GREEN';
      if (totalNs > totalEw) return 'NS_GREEN';
      return null;
    }
  }

  // If both empty
  if (totalNs <= 0 && totalEw <= 0) {
    // stay on current green if already green; else null
    return null;
  }

  if (current === 'NS_GREEN') {
    if (!inGreen) return null;
    if (elapsed < t.MIN_GREEN_MS) return null;
    if (elapsed >= t.GREEN_MS) {
      if (totalEw > 0) return 'EW_GREEN';
    }
    // hysteresis: switch if other > current*1.2
    if (totalEw > totalNs * 1.2 && totalEw > 0) {
      return 'EW_GREEN';
    }
    return null;
  }

  if (current === 'EW_GREEN') {
    if (!inGreen) return null;
    if (elapsed < t.MIN_GREEN_MS) return null;
    if (elapsed >= t.GREEN_MS) {
      if (totalNs > 0) return 'NS_GREEN';
    }
    if (totalNs > totalEw * 1.2 && totalNs > 0) {
      return 'NS_GREEN';
    }
    return null;
  }

  // Not in green phase - let engine decide based on state/target
  return null;
}
