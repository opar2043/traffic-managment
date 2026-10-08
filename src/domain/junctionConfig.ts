import { Direction, Phase, SignalState, JunctionConfig, VehicleWeight } from './types';

export const DEFAULT_CONFIG: JunctionConfig = {
  phases: [
    { name: 'NS_GREEN', directions: ['NORTH', 'SOUTH'], signal: 'GREEN' },
    { name: 'NS_YELLOW', directions: ['NORTH', 'SOUTH'], signal: 'YELLOW' },
    { name: 'ALL_RED', directions: ['NORTH', 'SOUTH', 'EAST', 'WEST'], signal: 'RED' },
    { name: 'EW_GREEN', directions: ['EAST', 'WEST'], signal: 'GREEN' },
    { name: 'EW_YELLOW', directions: ['EAST', 'WEST'], signal: 'YELLOW' },
  ],
  conflicts: { NS: ['NORTH', 'SOUTH'], EW: ['EAST', 'WEST'] },
  timings: {
    GREEN_MS: 30000,
    YELLOW_MS: 5000,
    ALL_RED_MS: 2000,
    MIN_GREEN_MS: 10000,
    ACK_TIMEOUT_MS: 5000,
    MAX_RETRIES: 1,
    MANUAL_TTL_MS: 300000,
    EMERGENCY_STALE_MS: 60000,
    MAX_WAIT_MS: 90000,
  },
};

export function normalizeConfig(raw: unknown): JunctionConfig {
  const r = (raw || {}) as Partial<JunctionConfig>;
  return {
    phases: Array.isArray(r.phases) && r.phases.length > 0 ? r.phases : DEFAULT_CONFIG.phases,
    conflicts: r.conflicts ? { ...DEFAULT_CONFIG.conflicts, ...r.conflicts } : DEFAULT_CONFIG.conflicts,
    timings: { ...DEFAULT_CONFIG.timings, ...(r.timings || {}) },
  };
}

export const VEHICLE_WEIGHT: VehicleWeight = {
  EMERGENCY: 100,
  TRUCK: 3,
  FORKLIFT: 2,
  EMPLOYEE_VEHICLE: 1,
};

export function getNextPhase(phase: Phase): Phase {
  const sequence: Phase[] = ['NS_GREEN', 'NS_YELLOW', 'ALL_RED', 'EW_GREEN', 'EW_YELLOW', 'ALL_RED'];
  // From spec: GREEN -> YELLOW -> ALL_RED -> other GREEN
  const map: Record<Phase, Phase> = {
    NS_GREEN: 'NS_YELLOW',
    NS_YELLOW: 'ALL_RED',
    ALL_RED: 'EW_GREEN', // will be overridden by logic when returning to specific direction
    EW_GREEN: 'EW_YELLOW',
    EW_YELLOW: 'ALL_RED',
  };
  return map[phase];
}

export function isNSPhase(phase: Phase): boolean {
  return phase === 'NS_GREEN' || phase === 'NS_YELLOW';
}

export function isEWPhase(phase: Phase): boolean {
  return phase === 'EW_GREEN' || phase === 'EW_YELLOW';
}

export function directionsForPhase(phase: Phase): Direction[] {
  if (phase === 'NS_GREEN' || phase === 'NS_YELLOW') return ['NORTH', 'SOUTH'];
  if (phase === 'EW_GREEN' || phase === 'EW_YELLOW') return ['EAST', 'WEST'];
  return ['NORTH', 'SOUTH', 'EAST', 'WEST'];
}

export function signalForPhase(phase: Phase): SignalState {
  if (phase === 'NS_GREEN' || phase === 'EW_GREEN') return 'GREEN';
  if (phase === 'NS_YELLOW' || phase === 'EW_YELLOW') return 'YELLOW';
  return 'RED';
}
