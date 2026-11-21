import { Global, Module } from '@nestjs/common';
import { JwtVerifier } from './jwt.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [SupabaseService, JwtVerifier],
  exports: [SupabaseService, JwtVerifier],
})
export class SupabaseModule {}
