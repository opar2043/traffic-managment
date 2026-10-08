import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';

export type Validator = (body: any) => { valid: boolean; errors?: string[]; data?: any };

export function validate(validator: Validator) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = validator(req.body);
    if (!result.valid) {
      throw new AppError('Validation failed', 400, result.errors);
    }
    (req as any).validated = result.data;
    next();
  };
}
