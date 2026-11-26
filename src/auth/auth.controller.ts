import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import { Role } from '../users/user.entity';
import { AddressDto, LoginDto, ProfileDto, RegisterDto, ResellerDto } from './auth.dto';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  /** App mobile (clients et vendeurs) */
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.phone, dto.password);
  }

  /** Back-office (équipe) */
  @Public()
  @Post('admin/login')
  adminLogin(@Body() dto: LoginDto) {
    return this.auth.login(dto.phone, dto.password, true);
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.sub);
  }

  @Patch('me')
  update(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) {
    return this.auth.updateProfile(u.sub, dto);
  }

  @Post('me/addresses')
  @Roles(Role.CUSTOMER)
  addAddress(@CurrentUser() u: AuthUser, @Body() dto: AddressDto) {
    return this.auth.addAddress(u.sub, dto);
  }

  @Delete('me/addresses/:id')
  @Roles(Role.CUSTOMER)
  removeAddress(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.removeAddress(u.sub, id);
  }

  @Post('me/reseller')
  @Roles(Role.CUSTOMER)
  reseller(@CurrentUser() u: AuthUser, @Body() dto: ResellerDto) {
    return this.auth.requestReseller(u.sub, dto);
  }
}
