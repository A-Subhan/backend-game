// ============================================================
// Lucky Guess — Auth Middleware
// Contoura Labs
// ============================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    isGuest: boolean;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'No authorization token provided',
      } as const);
      return;
    }

    const token = authHeader.substring(7);

    if (!token) {
      res.status(401).json({
        success: false,
        error: 'Empty authorization token',
      } as const);
      return;
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as {
      userId: string;
      isGuest: boolean;
    };

    req.user = {
      userId: decoded.userId,
      isGuest: decoded.isGuest ?? false,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      } as const);
      return;
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error during authentication',
    } as const);
  }
}

/**
 * Optional auth — attaches user if token present, but does not block.
 */
export function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token) {
        const decoded = jwt.verify(token, env.JWT_SECRET) as {
          userId: string;
          isGuest: boolean;
        };
        req.user = {
          userId: decoded.userId,
          isGuest: decoded.isGuest ?? false,
        };
      }
    }
  } catch {
    // Token invalid or expired — proceed without user
  }
  next();
}