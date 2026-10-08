import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';

const router = Router();

router.get('/:id/history', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const eventType = req.query.eventType as string | undefined;
  const where: any = { junctionId: req.params.id };
  if (eventType) where.eventType = eventType;
  const history = await prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(limit, 500),
  });
  res.json({ success: true, data: history });
}));

router.get('/:id/queues', asyncHandler(async (req, res) => {
  const queues = await prisma.queueVehicle.findMany({ where: { junctionId: req.params.id }, orderBy: { arrivedAt: 'asc' } });
  res.json({ success: true, data: queues });
}));

export default router;
