import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

export interface PostgrestLike {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export function raiseSupabase(error: PostgrestLike | null | undefined): asserts error is null | undefined {
  if (!error) return;
  const message = error.message || 'Request failed';
  const code = error.code ?? '';
  if (code === '42501' || code === '28000' || /row-level security/i.test(message)) {
    throw new ForbiddenException(message);
  }
  if (code === '23505') throw new ConflictException(message);
  if (code === 'PGRST116') throw new NotFoundException('Not found');
  if (code === '23503' || code === '23514' || code === '22023' || code === '22P02') {
    throw new BadRequestException(message);
  }
  throw new BadRequestException(message);
}
