import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class SubscribeDto {
  @ApiProperty({ example: 'growth', description: 'plans.code' })
  @IsString()
  plan_code!: string;

  @ApiProperty({ enum: ['monthly', 'yearly'] })
  @IsIn(['monthly', 'yearly'])
  billing_cycle!: 'monthly' | 'yearly';
}
