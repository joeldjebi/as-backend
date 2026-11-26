import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser, Public, Roles, Staff } from '../common/decorators';
import { IsPhone, PHONE_MESSAGE } from '../countries/phone';
import { Role, StaffRole, User } from '../users/user.entity';
import { ShopStatus } from './shop.entity';
import { MARKETS, ShopsService } from './shops.service';

const PHOTO = /^\/uploads\/[\w.-]+$/;
const ID_PHOTO = /^\/identity\/[\w.-]+$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

class HoursDto {
  @Matches(HM, { message: 'Heure d’ouverture : HH:MM' }) open: string;
  @Matches(HM, { message: 'Heure de fermeture : HH:MM' }) close: string;
  @IsArray() @ArrayMinSize(1, { message: 'Choisissez au moins un jour' }) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days: number[];
}
class ShopDto {
  @IsOptional() @IsString() @IsNotEmpty({ message: 'Nom de la boutique obligatoire' }) @MaxLength(80) name?: string;
  @IsOptional() @IsIn(['BOUTIQUE', 'GROSSISTE'], { message: 'Type : boutique ou grossiste' }) type?: 'BOUTIQUE' | 'GROSSISTE';
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsPhone({ optional: true, message: `Téléphone de la boutique : ${PHONE_MESSAGE}` }) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) market?: string;
  @IsOptional() @IsString() @MaxLength(150) location?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(5, { message: '5 catégories maximum' }) @IsUUID('all', { each: true }) categoryIds?: string[];
  @IsOptional() @Matches(PHOTO) logoUrl?: string;
  @IsOptional() @Matches(PHOTO, { message: 'Photo de la devanture invalide' }) storefrontUrl?: string;
  @IsOptional() @IsIn(['CNI', 'PASSPORT', 'CONSULAR', 'RESIDENCE'], { message: 'Type de pièce inconnu' }) ownerIdType?: string;
  @IsOptional() @IsString() @MaxLength(40) ownerIdNumber?: string;
  @IsOptional() @Matches(ID_PHOTO, { message: 'Photo de la pièce invalide' }) ownerIdFrontUrl?: string;
  @IsOptional() @Matches(ID_PHOTO, { message: 'Photo de la pièce invalide' }) ownerIdBackUrl?: string;
  @IsOptional() @IsString() @MaxLength(60) tradeRegister?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => HoursDto) hours?: HoursDto | null;
  @IsOptional() @IsBoolean() isOpen?: boolean;
}
class NoteDto {
  @IsString() @IsNotEmpty({ message: 'Motif obligatoire' }) @MaxLength(500) note: string;
}
class FeaturedDto {
  @IsBoolean() featured: boolean;
}
class StatusQuery {
  @IsOptional() @IsEnum(ShopStatus) status?: ShopStatus;
}

@Controller('shops')
export class ShopsController {
  constructor(private service: ShopsService, @InjectRepository(User) private users: Repository<User>) {}

  private async by(u: AuthUser) {
    return (await this.users.findOneBy({ id: u.sub }))?.name ?? 'Équipe';
  }

  // ----- Public -----
  @Public()
  @Get('meta')
  meta() {
    return { markets: MARKETS };
  }

  @Public()
  @Get()
  list(@Query('categoryId') categoryId?: string) {
    return this.service.publicList(categoryId);
  }

  // ----- Vendeur -----
  @Get('mine')
  @Roles(Role.CUSTOMER)
  mine(@CurrentUser() u: AuthUser) {
    return this.service.listMine(u.sub);
  }

  @Post()
  @Roles(Role.CUSTOMER)
  create(@CurrentUser() u: AuthUser, @Body() dto: ShopDto) {
    return this.service.create(u.sub, dto);
  }

  @Patch('mine/:id')
  @Roles(Role.CUSTOMER)
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShopDto) {
    return this.service.update(u.sub, id, dto);
  }

  @Post('mine/:id/submit')
  @Roles(Role.CUSTOMER)
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.submit(u.sub, id);
  }

  // ----- Équipe -----
  @Get('admin')
  @Roles(Role.ADMIN)
  adminList(@Query() q: StatusQuery) {
    return this.service.list(q.status);
  }

  @Get('admin/:id')
  @Roles(Role.ADMIN)
  adminOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.one(id);
  }

  @Post('admin/:id/approve')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.approve(id, await this.by(u));
  }

  @Post('admin/:id/reject')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.service.reject(id, await this.by(u), dto.note);
  }

  @Post('admin/:id/suspend')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async suspend(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.service.suspend(id, await this.by(u), dto.note);
  }

  @Post('admin/:id/reactivate')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async reactivate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reactivate(id, await this.by(u));
  }

  @Post('admin/:id/featured')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  featured(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FeaturedDto) {
    return this.service.setFeatured(id, dto.featured);
  }

  /** Après les routes « admin » et « mine » : page publique d'une boutique (slug ou id) */
  @Public()
  @Get(':slug')
  one(@Param('slug') slug: string) {
    return this.service.publicOne(slug);
  }
}
