import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt, { JwtHeader, JwtPayload, SigningKeyCallback } from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

function usable(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('your-') || trimmed.includes('[YOUR-')) return undefined;
  return trimmed;
}

@Injectable()
export class JwtVerifier {
  private jwks?: jwksRsa.JwksClient;

  constructor(private readonly config: ConfigService) {}

  async verify(token: string): Promise<JwtPayload> {
    const jwksUrl = usable(this.config.get<string>('SUPABASE_JWKS_URL'));
    const secret = usable(this.config.get<string>('SUPABASE_JWT_SECRET'));
    try {
      const payload = jwksUrl
        ? await this.verifyWithJwks(token, jwksUrl)
        : secret
          ? await this.verifyWithSecret(token, secret)
          : null;
      if (!payload) throw new UnauthorizedException('Set SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL');
      if (!payload.sub) throw new UnauthorizedException('Token is missing sub');
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid token');
    }
  }

  private verifyWithSecret(token: string, secret: string) {
    return new Promise<JwtPayload>((resolve, reject) => {
      jwt.verify(token, secret, { algorithms: ['HS256'] }, (error, decoded) => {
        if (error || !decoded || typeof decoded === 'string') reject(error ?? new Error('invalid token'));
        else resolve(decoded);
      });
    });
  }

  private verifyWithJwks(token: string, jwksUrl: string) {
    this.jwks ??= jwksRsa({ jwksUri: jwksUrl, cache: true, rateLimit: true });
    const client = this.jwks;
    const getKey = (header: JwtHeader, callback: SigningKeyCallback) => {
      if (!header.kid) {
        callback(new Error('missing kid'));
        return;
      }
      client.getSigningKey(header.kid, (error, key) => {
        if (error || !key) callback(error ?? new Error('signing key not found'));
        else callback(null, key.getPublicKey());
      });
    };
    return new Promise<JwtPayload>((resolve, reject) => {
      jwt.verify(token, getKey, { algorithms: ['RS256', 'ES256'] }, (error, decoded) => {
        if (error || !decoded || typeof decoded === 'string') reject(error ?? new Error('invalid token'));
        else resolve(decoded);
      });
    });
  }
}
