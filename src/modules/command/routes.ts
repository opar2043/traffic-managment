import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { junctionRunner } from '../../services/junctionRunner';

const router = Router();

router.post('/junctions/:id/commands', asyncHandler(async (req, res) => {
  const { command, direction } = req.body;
  if (command === 'MANUAL_GREEN_REQUEST') {
    if (!direction || !['NORTH', 'SOUTH', 'EAST', 'WEST'].includes(direction)) {
      throw new AppError('direction required for MANUAL_GREEN_REQUEST', 400);
    }
    const r = await junctionRunner.manualGreen(req.params.id, direction as any);
    if (r.rejected) {
      throw new AppError('Command rejected (EMERGENCY or DEGRADED)', 409);
    }
    res.status(202).json({ success: true, message: 'Manual green requested' });
    return;
  }
  if (command === 'RETURN_TO_AUTOMATIC') {
    const r = await junctionRunner.returnToAuto(req.params.id);
    if (r.rejected) {
      throw new AppError('Cannot return to AUTOMATIC while in EMERGENCY/DEGRADED', 409);
    }
    res.status(202).json({ success: true, message: 'Returning to AUTOMATIC' });
    return;
  }
  throw new AppError('Unknown command', 400);
}));

export default router;
