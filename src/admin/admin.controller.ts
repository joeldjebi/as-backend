import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser, Roles, Staff } from '../common/decorators';
import { IsPhone, PHONE_MESSAGE } from '../countries/phone';
import { identityLink } from '../uploads/uploads.controller';
import { ResellerStatus, Role, StaffRole, User } from '../users/user.entity';

class StaffDto {
  @IsString() @IsNotEmpty({ message: 'Nom obligatoire' }) @MaxLength(100) name: string;
  @IsPhone({ message: PHONE_MESSAGE }) phone: string;
  @IsString() @MinLength(6, { message: 'Mot de passe : 6 caractères minimum' }) password: string;
  @IsEnum(StaffRole, { message: 'Rôle inconnu' }) staffRole: StaffRole;
}
class StaffUpdateDto {
  @IsOptional() @IsEnum(StaffRole) staffRole?: StaffRole;
  @IsOptional() @IsBoolean() active?: boolean;
}
class NoteDto {
  @IsString() @IsNotEmpty({ message: 'Motif obligatoire' }) @MaxLength(500) note: string;
}

/** Back-office : tableau de bord, revendeurs, clients, équipe */
@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(@InjectRepository(User) private users: Repository<User>) {}

  private async by(u: AuthUser) {
    return (await this.users.findOneBy({ id: u.sub }))?.name ?? 'Équipe';
  }

  @Get('dashboard')
  async dashboard() {
    const [r] = await this.users.query(
      `SELECT (SELECT count(*)::int FROM users WHERE role = 'CUSTOMER') AS customers,
              (SELECT count(*)::int FROM users WHERE role = 'CUSTOMER' AND "createdAt" > now() - interval '7 days') AS "customersWeek",
              (SELECT count(*)::int FROM shops WHERE status = 'APPROVED') AS "shopsApproved",
              (SELECT count(*)::int FROM shops WHERE status = 'PENDING') AS "shopsPending",
              (SELECT count(*)::int FROM shops WHERE status = 'DRAFT') AS "shopsDraft",
              (SELECT count(*)::int FROM users WHERE "resellerStatus" = 'PENDING') AS "resellersPending",
              (SELECT count(*)::int FROM users WHERE "resellerStatus" = 'APPROVED') AS resellers,
              (SELECT count(*)::int FROM categories WHERE "parentId" IS NULL AND active) AS categories,
              (SELECT count(*)::int FROM products WHERE status = 'ACTIVE') AS products,
              (SELECT count(*)::int FROM products WHERE jsonb_array_length(reports) > 0 AND status <> 'REMOVED') AS "productsReported"`,
    );
    return r;
  }

  // ----- Clients -----
  @Get('customers')
  async customers(@Query('q') q?: string) {
    return this.users.query(
      `SELECT u.id, u.name, u.phone, u.active, u."resellerStatus", u."createdAt",
              (SELECT count(*)::int FROM shops s WHERE s."ownerId" = u.id) AS shops
         FROM users u WHERE u.role = 'CUSTOMER' AND ($1::text IS NULL OR u.name ILIKE '%' || $1 || '%' OR u.phone LIKE '%' || $1 || '%')
        ORDER BY u."createdAt" DESC LIMIT 500`,
      [q?.trim() || null],
    );
  }

  @Patch('customers/:id/active')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { active: boolean }) {
    const u = await this.users.findOneBy({ id, role: Role.CUSTOMER });
    if (!u) throw new NotFoundException('Client introuvable');
    await this.users.update(id, { active: !!dto.active });
    return { ok: true };
  }

  // ----- Revendeurs -----
  @Get('resellers')
  async resellers(@Query('status') status?: ResellerStatus) {
    const rows = await this.users.find({
      where: { role: Role.CUSTOMER, resellerStatus: status && Object.values(ResellerStatus).includes(status) ? status : ResellerStatus.PENDING },
      order: { updatedAt: 'DESC' },
      take: 500,
    });
    return rows.map((u) => ({ id: u.id, name: u.name, phone: u.phone, resellerStatus: u.resellerStatus, reseller: u.reseller, idPhotoLink: identityLink(u.reseller?.idPhotoUrl) }));
  }

  private async decide(id: string, to: ResellerStatus, by: string, note?: string) {
    const u = await this.users.findOneBy({ id });
    if (!u || u.resellerStatus !== ResellerStatus.PENDING) throw new BadRequestException('Demande introuvable ou déjà traitée');
    u.resellerStatus = to;
    u.reseller = { ...u.reseller!, reviewedBy: by, reviewedAt: new Date().toISOString(), note: note?.trim() || null };
    await this.users.save(u);
    return { ok: true };
  }

  @Post('resellers/:id/approve')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async approve(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.decide(id, ResellerStatus.APPROVED, await this.by(me));
  }

  @Post('resellers/:id/reject')
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.MODERATOR)
  async reject(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.decide(id, ResellerStatus.REJECTED, await this.by(me), dto.note);
  }

  // ----- Équipe -----
  @Get('staff')
  staff() {
    return this.users.find({ where: { role: Role.ADMIN }, order: { createdAt: 'ASC' } });
  }

  @Post('staff')
  @Staff(StaffRole.SUPER_ADMIN)
  async addStaff(@Body() dto: StaffDto) {
    if (await this.users.existsBy({ phone: dto.phone })) throw new ConflictException('Ce numéro a déjà un compte');
    await this.users.save(this.users.create({ name: dto.name.trim(), phone: dto.phone, passwordHash: await bcrypt.hash(dto.password, 10), role: Role.ADMIN, staffRole: dto.staffRole }));
    return this.staff();
  }

  @Patch('staff/:id')
  @Staff(StaffRole.SUPER_ADMIN)
  async updateStaff(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffUpdateDto) {
    if (id === me.sub) throw new BadRequestException('Vous ne pouvez pas modifier votre propre rôle');
    const u = await this.users.findOneBy({ id, role: Role.ADMIN });
    if (!u) throw new NotFoundException('Membre introuvable');
    if (dto.staffRole) u.staffRole = dto.staffRole;
    if (dto.active !== undefined) u.active = dto.active;
    await this.users.save(u);
    return this.staff();
  }
}
