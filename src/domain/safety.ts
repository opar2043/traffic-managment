import { SignalMap } from './types';

export function assertSafe(signals: SignalMap): void {
  const nsGreen = signals.NORTH === 'GREEN' && signals.SOUTH === 'GREEN';
  const ewGreen = signals.EAST === 'GREEN' && signals.WEST === 'GREEN';

  // Also handle individual GREENs? Spec states NS+SOUTH and EW+WEST must never be GREEN at same time.
  // But a single direction GREEN alone is not conflicting unless paired with opposite in same pair being GREEN simultaneously.
  // However, also ensure we don't have a GREEN in NS pair and GREEN in EW pair at same time.
  const nsAnyGreen = signals.NORTH === 'GREEN' || signals.SOUTH === 'GREEN';
  const ewAnyGreen = signals.EAST === 'GREEN' || signals.WEST === 'GREEN';

  if (nsGreen && ewGreen) {
    throw new Error('SAFETY_VIOLATION: NS and EW both GREEN');
  }
  // If any NS direction is GREEN, both NS must be GREEN? No - wait: each direction is controlled individually.
  // But junction pairs: NORTH+SOUTH form one approach, EAST+WEST another. They must never be GREEN at the same time.
  // That means you cannot have NORTH GREEN while EAST is GREEN. Also cannot have NORTH+SOUTH both GREEN while EAST+WEST both GREEN.
  // But you could have NORTH GREEN and SOUTH RED? That would be unsafe/odd - but spec states the rule as written.
  // The rule says: "NORTH+SOUTH and EAST+WEST must never be GREEN at the same time."
  // So the condition is: (NORTH and SOUTH both GREEN) AND (EAST and WEST both GREEN) is forbidden.
  // Also implies you shouldn't have mixed greens across conflicting pairs? Let us read: "NORTH+SOUTH and EAST+WEST must never be GREEN at the same time."
  // So if NORTH+SOUTH are GREEN as a pair, EAST+WEST cannot be GREEN as a pair. But individual mixed states?
  // To be safe and match "conflicting GREENs" - any GREEN in NS pair and any GREEN in EW pair is conflicting? That depends.
  // But common traffic: typically both directions in the same phase go GREEN together. Let us enforce conservative rule:
  // No direction in NS set may be GREEN at the same time as any direction in EW set is GREEN.
  if ((signals.NORTH === 'GREEN' || signals.SOUTH === 'GREEN') && (signals.EAST === 'GREEN' || signals.WEST === 'GREEN')) {
    throw new Error('SAFETY_VIOLATION: Conflicting GREEN across NS and EW');
  }
}
