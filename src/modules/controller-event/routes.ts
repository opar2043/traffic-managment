import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { junctionRunner } from '../../services/junctionRunner';
import { prisma } from '../../lib/prisma';

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const { command_id, junction_id, status, actual_state } = req.body;
  if (!command_id) throw new AppError('command_id required', 400);
  if (!status || !['ACK', 'NACK', 'FAILED'].includes(status)) {
    throw new AppError('status must be ACK|NACK|FAILED', 400);
  }
  const result = await junctionRunner.handleAck(command_id, status as any, actual_state);
  if (!result.ok) {
    if (result.reason === 'UNKNOWN_COMMAND') throw new AppError('Unknown command_id', 404);
    throw new AppError('Failed to process controller event', 400);
  }
  res.json({ success: true, duplicate: result.duplicate || false });
}));

export default router;
