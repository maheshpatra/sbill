import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntitlementsGuard } from './entitlements.guard';
import { FeatureLockedException } from './feature-locked';

describe('EntitlementsGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const entitlements = { assertFeature: jest.fn() };
  const guard = new EntitlementsGuard(reflector as unknown as Reflector, entitlements as never);

  function context(): ExecutionContext {
    return {
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user', token: 'token' } }) }),
    } as unknown as ExecutionContext;
  }

  it('lets a request through when the route has no feature', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(entitlements.assertFeature).not.toHaveBeenCalled();
  });

  it('rejects a locked feature with FEATURE_LOCKED', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => (key === 'requiresFeature' ? 'pos' : undefined));
    entitlements.assertFeature.mockRejectedValue(new FeatureLockedException('pos'));
    await expect(guard.canActivate(context())).rejects.toMatchObject({
      status: 402,
      response: { code: 'FEATURE_LOCKED', feature: 'pos', required_plan: 'growth' },
    });
  });
});
