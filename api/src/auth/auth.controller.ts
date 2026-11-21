import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { AuthContext } from '../common/auth-context';
import { CurrentUser } from '../common/decorators';
import { AuthService } from './auth.service';

class ProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar_url?: string;
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  @ApiOkResponse({ description: 'Profile, memberships, and JWT tenant claims (hints only).' })
  me(@CurrentUser() user: AuthContext) {
    return this.auth.me(user);
  }

  @Patch('me')
  @ApiBody({ type: ProfileDto })
  updateMe(@CurrentUser() user: AuthContext, @Body() dto: ProfileDto) {
    return this.auth.updateMe(user, dto);
  }
}

@ApiTags('auth')
@ApiBearerAuth()
@Controller()
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return this.auth.me(user);
  }

  @Patch('me')
  @ApiBody({ type: ProfileDto })
  updateMe(@CurrentUser() user: AuthContext, @Body() dto: ProfileDto) {
    return this.auth.updateMe(user, dto);
  }
}
