import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { Repository } from 'typeorm';
import { Account, AuthUser, CurrentUser, Public, Roles, Staff } from '../common/decorators';
import { Role, StaffRole, User } from '../users/user.entity';
import { ProductsService } from './products.service';

const PHOTO = /^\/uploads\/[\w.-]+$/;
const MONEY = { message: 'Prix : nombre entier en francs' };

class VariantDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty({ message: 'Nom de variante obligatoire' }) @MaxLength(60) label: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt(MONEY) @Min(1) @Max(50_000_000) price?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) stock?: number | null;
}
class ProductDto {
  @IsOptional() @IsUUID() shopId?: string;
  @IsOptional() @IsUUID('all', { message: 'Catégorie obligatoire' }) categoryId?: string;
  @IsOptional() @IsString() @IsNotEmpty({ message: 'Nom du produit obligatoire' }) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6, { message: '6 photos maximum' }) @Matches(PHOTO, { each: true, message: 'Photo invalide' }) photos?: string[];
  @IsOptional() @Type(() => Number) @IsInt(MONEY) @Min(1, { message: 'Prix obligatoire' }) @Max(50_000_000) price?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt(MONEY) @Min(1) @Max(50_000_000) wholesalePrice?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(2) @Max(100_000) wholesaleMinQty?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) stock?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => VariantDto) variants?: VariantDto[];
  @IsOptional() @IsBoolean() active?: boolean;
}
const num = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));
class SearchDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() shopId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() wholesale?: boolean;
  @IsOptional() @Transform(num) @IsInt() @Min(0) minPrice?: number;
  @IsOptional() @Transform(num) @IsInt() @Min(0) maxPrice?: number;
  @IsOptional() @IsIn(['new', 'price_asc', 'price_desc', 'popular']) sort?: 'new' | 'price_asc' | 'price_desc' | 'popular';
  @IsOptional() @Transform(num) @IsInt() @Min(1) @Max(500) page?: number;
}
class ReportDto {
  @IsString() @IsNotEmpty({ message: 'Motif obligatoire' }) @MaxLength(300) reason: string;
}
class NoteDto {
  @IsString() @IsNotEmpty({ message: 'Motif obligatoire' }) @MaxLength(500) note: string;
}

@Controller('products')
export class ProductsController {
  constructor(private service: ProductsService, @InjectRepository(User) private users: Repository<User>) {}

  // ----- Public (prix de gros si revendeur connecté) -----
  @Public()
  @Get('home')
  home(@Account() viewer?: User) {
    return this.service.home(viewer);
  }

  @Public()
  @Get()
  search(@Query() q: SearchDto, @Account() viewer?: User) {
    return this.service.search(q, viewer);
  }

  // ----- Vendeur -----
  @Get('mine')
  @Roles(Role.CUSTOMER)
  mine(@CurrentUser() u: AuthUser, @Query('shopId', ParseUUIDPipe) shopId: string) {
    return this.service.listMine(u.sub, shopId);
  }

  @Post()
  @Roles(Role.CUSTOMER)
  create(@CurrentUser() u: AuthUser, @Body() dto: ProductDto) {
    return this.service.create(u.sub, dto);
  }

  @Patch('mine/:id')
  @Roles(Role.CUSTOMER)
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductDto) {
    return this.service.update(u.sub, id, dto);
  }

  @Post('mine/:id/duplicate')
  @Roles(Role.CUSTOMER)
  duplicate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.duplicate(u.sub, id);
  }

  @Delete('mine/:id')
  @Roles(Role.CUSTOMER)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(u.sub, id);
  }

  @Post(':id/report')
  @Roles(Role.CUSTOMER)
  report(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportDto) {
    return this.service.report(id, u.sub, dto.reason);
  }

  // ----- Équipe -----
  @Get('admin')
  @Roles(Role.ADMIN)
  adminList(@Query('filter') filter?: string, @Query('q') q?: string) {
    return this.service.adminList(filter === 'removed' || filter === 'all' ? filter : 'reported', q);
  }

  @Post('admin/:id/remove')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async removeProduct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.service.moderate(id, true, (await this.users.findOneBy({ id: u.sub }))?.name ?? 'Équipe', dto.note);
  }

  @Post('admin/:id/clear')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async clear(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.moderate(id, false, (await this.users.findOneBy({ id: u.sub }))?.name ?? 'Équipe');
  }

  /** Après les routes nommées : fiche d'un produit */
  @Public()
  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string, @Account() viewer?: User) {
    return this.service.one(id, viewer);
  }
}
