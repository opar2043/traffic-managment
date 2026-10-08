import { ControllerCommandState } from '../domain/types';

export interface ControllerPort {
  sendCommand(cmd: ControllerCommandState): Promise<void>;
}
