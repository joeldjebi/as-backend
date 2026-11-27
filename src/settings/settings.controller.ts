import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser, Roles, Staff } from '../common/decorators';
import { LetoService } from '../orders/leto.service';
import { Role, StaffRole, User } from '../users/user.entity';
import { MANAGED, SECRET_KEYS, SettingKey, SettingsService } from './settings.service';

const empty = (_: unknown, v: unknown) => v !== '';
class SettingsDto {
  @IsOptional() @IsString() @ValidateIf(empty) @Matches(/^https:\/\/[\w.-]+(:\d+)?\/?$/, { message: 'Adresse de l’API VITE : https://… (ex. https://api.vite.ci)' }) LETO_API_URL?: string;
  @IsOptional() @IsString() @ValidateIf(empty) @Matches(/^leto_(live|test)_[A-Za-z0-9]{16,}$/, { message: 'Clé VITE : elle commence par leto_live_' }) LETO_API_KEY?: string;
  @IsOptional() @IsString() @ValidateIf(empty) @Matches(/^whsec_[A-Za-z0-9]{16,}$/, { message: 'Secret de signature : il commence par whsec_' }) LETO_WEBHOOK_SECRET?: string;
  @IsOptional() @IsString() @MaxLength(60) AS_PISPI_ALIAS?: string;
  @IsOptional() @IsString() @MaxLength(80) AS_PISPI_NAME?: string;
  @IsOptional() @IsIn(['true', 'false']) DIRECT_PAYOUT_ALL?: string;
}

/** Super Admin : livraison VITE (clé, secret) et encaissement Adjamé-Smart, modifiables sans toucher au serveur */
@Controller('admin/settings')
@Roles(Role.ADMIN)
@Staff(StaffRole.SUPER_ADMIN)
export class SettingsController {
  constructor(private settings: SettingsService, private leto: LetoService, @InjectRepository(User) private users: Repository<User>) {}

  /** Les secrets ne sont jamais renvoyés : seulement « renseigné » et leurs 4 derniers caractères */
  private view() {
    const out: Record<string, unknown> = {};
    for (const key of MANAGED) {
      const value = this.settings.get(key);
      const secret = SECRET_KEYS.includes(key);
      out[key] = {
        value: secret ? null : value,
        set: !!value,
        hint: secret && value ? `…${value.slice(-4)}` : null,
        source: this.settings.source(key),
        ...this.settings.meta(key),
      };
    }
    return { settings: out, webhookUrl: `${(process.env.PUBLIC_API_URL ?? 'https://api.as.vite.ci').replace(/\/$/, '')}/webhooks/leto` };
  }

  @Get()
  get() {
    return this.view();
  }

  @Put()
  async update(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) {
    const by = (await this.users.findOneBy({ id: u.sub }))?.name ?? 'Super Admin';
    await this.settings.set(dto as Partial<Record<SettingKey, string>>, by);
    return this.view();
  }

  /** Vérifie la clé auprès de VITE (partenaire, actif, adresse des notifications) */
  @Post('test-leto')
  @HttpCode(200)
  async test() {
    if (!this.leto.configured) throw new BadRequestException('Renseignez l’adresse de l’API et la clé VITE');
    try {
      return await this.leto.me();
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
