import { AsyncLocalStorage } from 'async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { Entitlements } from '@billflow/types';

export const entitlementCache = new AsyncLocalStorage<Map<string, Entitlements>>();

@Injectable()
export class EntitlementCacheMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    entitlementCache.run(new Map(), () => next());
  }
}
