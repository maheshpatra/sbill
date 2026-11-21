import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Min } from 'class-validator';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { StorageService } from './storage.service';

class PresignDto {
  @ApiProperty({ enum: ['logo', 'avatar', 'bill_photo', 'product', 'site'] })
  @IsIn(['logo', 'avatar', 'bill_photo', 'product', 'site'])
  kind!: 'logo' | 'avatar' | 'bill_photo' | 'product' | 'site';

  @ApiProperty({ example: 'image/png' })
  @IsString()
  content_type!: string;

  @ApiProperty({ example: 120000 })
  @IsInt()
  @Min(1)
  size!: number;
}

@ApiBearerAuth()
@Controller('uploads')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('presign')
  @ApiBody({ type: PresignDto })
  presign(@CurrentUser() user: AuthContext, @Body() dto: PresignDto) {
    return this.storage.presign(user, dto);
  }
}
