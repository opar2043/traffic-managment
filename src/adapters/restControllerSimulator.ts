import { ControllerPort } from '../ports/controllerPort';
import { ControllerCommandState } from '../domain/types';
import { logger } from '../lib/logger';

export class RestControllerSimulator implements ControllerPort {
  async sendCommand(cmd: ControllerCommandState): Promise<void> {
    // Command row is already persisted as PENDING by the caller (upsert / timeout retry).
    // Just log; evaluator ACKs via the controller-events endpoint.
    logger.info(`[ControllerSimulator] Sending command ${cmd.id} requestedState=${cmd.requestedState} dir=${cmd.direction}`);
  }
}
