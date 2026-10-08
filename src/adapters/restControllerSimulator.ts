import { ControllerPort } from '../ports/controllerPort';
import { ControllerCommandState, CommandStatus } from '../domain/types';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export class RestControllerSimulator implements ControllerPort {
  async sendCommand(cmd: ControllerCommandState): Promise<void> {
    logger.info(`[ControllerSimulator] Sending command ${cmd.id} requestedState=${cmd.requestedState} dir=${cmd.direction}`);
    // Record as PENDING in DB (already created). Just log; evaluator will ACK via controller-events.
    try {
      // never overwrite a command that was ACKED/FAILED/TIMED_OUT in the meantime
      await prisma.controllerCommand.updateMany({
        where: { id: cmd.id, status: 'PENDING' },
        data: { status: 'PENDING', attempts: cmd.attempts, sentAt: cmd.sentAt },
      });
    } catch (e) {
      // ignore
    }
  }
}
