import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';

const router = Router();

router.get('/:id/status', asyncHandler(async (req, res) => {
  const j = await prisma.junction.findUnique({ where: { id: req.params.id } });
  if (!j) throw new AppError('Junction not found', 404);
  const pending = await prisma.controllerCommand.findFirst({ where: { junctionId: req.params.id, status: 'PENDING' }, orderBy: { sentAt: 'desc' } });
  const alerts: string[] = [];
  if (j.controllerStatus !== 'ONLINE') alerts.push(`Controller ${j.controllerStatus}`);
  // check mismatches
  const desired = j.desiredSignals as any;
  const actual = j.actualSignals as any;
  if (desired && actual) {
    for (const k of ['NORTH', 'SOUTH', 'EAST', 'WEST']) {
      if (desired[k] !== actual[k] && desired[k] !== 'UNKNOWN' && actual[k] !== 'UNKNOWN') {
        alerts.push('STATE_MISMATCH');
        break;
      }
    }
  }
  const data = {
    id: j.id,
    name: j.name,
    mode: j.mode,
    phase: j.phase,
    desiredSignals: j.desiredSignals,
    actualSignals: j.actualSignals,
    controllerStatus: j.controllerStatus,
    phaseStartedAt: j.phaseStartedAt,
    phaseEndsAt: j.phaseEndsAt,
    nextPhaseTarget: j.nextPhaseTarget,
    manual: { active: j.mode === 'MANUAL', until: j.manualUntil, direction: j.manualDirection },
    emergency: { active: j.mode === 'EMERGENCY', direction: j.emergencyDirection, since: j.emergencySince },
    pendingCommand: pending ? { id: pending.id, direction: pending.direction, requestedState: pending.requestedState, status: pending.status, sentAt: pending.sentAt } : null,
    alerts,
    transitionStep: j.phase,
  };
  res.json({ success: true, data });
}));

export default router;
