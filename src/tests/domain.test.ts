import { describe, it, expect } from 'vitest';
import { assertSafe } from '../domain/safety';
import { SignalMap, JunctionState, Direction, VehicleType } from '../domain/types';
import { DEFAULT_CONFIG } from '../domain/junctionConfig';
import { handleTick, requestManualGreen, returnToAutomatic, onEmergency } from '../domain/trafficEngine';

function mkState(overrides: Partial<JunctionState> = {}): JunctionState {
  const now = new Date();
  return {
    id: 'A',
    name: 'A',
    config: DEFAULT_CONFIG,
    mode: 'AUTOMATIC',
    phase: 'ALL_RED',
    desiredSignals: { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' },
    actualSignals: { NORTH: 'RED', SOUTH: 'RED', EAST: 'RED', WEST: 'RED' },
    controllerStatus: 'ONLINE',
    phaseStartedAt: now,
    phaseEndsAt: new Date(now.getTime() + 2000),
    nextPhaseTarget: null,
    manualUntil: null,
    manualDirection: null,
    emergencyDirection: null,
    emergencySince: null,
    version: 0,
    lastTickAt: now,
    ...overrides,
  };
}

describe('safety', () => {
  it('no conflicting GREEN ever', () => {
    const s: SignalMap = { NORTH: 'GREEN', SOUTH: 'GREEN', EAST: 'GREEN', WEST: 'GREEN' };
    expect(() => assertSafe(s)).toThrow();
  });
  it('allows NS GREEN with EW RED', () => {
    const s: SignalMap = { NORTH: 'GREEN', SOUTH: 'GREEN', EAST: 'RED', WEST: 'RED' };
    expect(() => assertSafe(s)).not.toThrow();
  });
  it('allows EW GREEN with NS RED', () => {
    const s: SignalMap = { NORTH: 'RED', SOUTH: 'RED', EAST: 'GREEN', WEST: 'GREEN' };
    expect(() => assertSafe(s)).not.toThrow();
  });
});

describe('state machine basics', () => {
  it('emergency overrides manual', () => {
    const state = mkState({ mode: 'MANUAL', manualDirection: 'NORTH', manualUntil: new Date(Date.now() + 60000) });
    const res = onEmergency({ state, now: new Date(), direction: 'EAST', vehicleId: 'em1', active: true });
    expect(res.state.mode).toBe('EMERGENCY');
    expect(res.state.emergencyDirection).toBe('EAST');
  });

  it('emergency moves to ALL_RED sequence', () => {
    const state = mkState({ phase: 'NS_GREEN', mode: 'AUTOMATIC' });
    const res = onEmergency({ state, now: new Date(), direction: 'EAST', vehicleId: 'em1', active: true });
    expect(res.state.phase).toBe('ALL_RED');
    expect(res.state.desiredSignals.NORTH).toBe('RED');
    expect(res.state.desiredSignals.EAST).toBe('RED');
  });

  it('manual request rejected in emergency', () => {
    const state = mkState({ mode: 'EMERGENCY', emergencyDirection: 'EAST' });
    const res = requestManualGreen({ state, now: new Date(), direction: 'NORTH' });
    expect(res.state.mode).toBe('EMERGENCY');
  });

  it('return to auto allowed from manual', () => {
    const state = mkState({ mode: 'MANUAL', manualDirection: 'NORTH' });
    const res = returnToAutomatic({ state, now: new Date() });
    expect(res.state.mode).toBe('AUTOMATIC');
  });

  it('return to auto rejected in emergency', () => {
    const state = mkState({ mode: 'EMERGENCY', emergencyDirection: 'EAST' });
    const res = returnToAutomatic({ state, now: new Date() });
    expect(res.state.mode).toBe('EMERGENCY');
  });
});
