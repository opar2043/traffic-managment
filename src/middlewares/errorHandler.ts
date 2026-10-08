import { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';

export function errorHandler(err: Error | AppError, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.details,
    });
    return;
  }
  console.error(err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
}
