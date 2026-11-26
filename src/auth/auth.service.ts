import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { normalizePhone } from '../countries/phone';
import { ResellerStatus, Role, StaffRole, User } from '../users/user.entity';
import { AddressDto, ProfileDto, RegisterDto, ResellerDto } from './auth.dto';

@Injectable()
export class AuthService implements OnModuleInit {
  private logger = new Logger(AuthService.name);
  constructor(private jwt: JwtService, @InjectRepository(User) private users: Repository<User>) {}

  /** Premier Super Admin, depuis le .env (créé une seule fois) */
  async onModuleInit() {
    const phone = normalizePhone(process.env.SUPER_ADMIN_PHONE ?? '');
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!phone || !password) return;
    if (await this.users.existsBy({ phone })) return;
    await this.users.save(
      this.users.create({ name: process.env.SUPER_ADMIN_NAME || 'Super Admin', phone, passwordHash: await bcrypt.hash(password, 10), role: Role.ADMIN, staffRole: StaffRole.SUPER_ADMIN }),
    );
    this.logger.log('Compte Super Admin créé');
  }

  /** Compte renvoyé aux apps (sans mot de passe), avec ses boutiques */
  async me(id: string) {
    const u = await this.users.findOneBy({ id });
    if (!u) throw new NotFoundException('Compte introuvable');
    const shops = await this.users.manager.query(`SELECT id, name, status FROM shops WHERE "ownerId" = $1 ORDER BY "createdAt"`, [id]);
    return { ...u, shops };
  }

  private async session(u: User) {
    return { token: await this.jwt.signAsync({ sub: u.id, role: u.role }), user: await this.me(u.id) };
  }

  async register(dto: RegisterDto) {
    if (await this.users.existsBy({ phone: dto.phone })) throw new ConflictException('Ce numéro a déjà un compte : connectez-vous');
    const u = await this.users.save(this.users.create({ name: dto.name.trim(), phone: dto.phone, passwordHash: await bcrypt.hash(dto.password, 10) }));
    return this.session(u);
  }

  async login(phone: string, password: string, admin = false) {
    const u = await this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.phone = :phone', { phone }).getOne();
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw new UnauthorizedException('Numéro ou mot de passe incorrect');
    if (!u.active) throw new UnauthorizedException('Compte désactivé : contactez Adjamé-Smart');
    if (admin && u.role !== Role.ADMIN) throw new UnauthorizedException('Ce compte n’a pas accès au back-office');
    if (!admin && u.role === Role.ADMIN) throw new UnauthorizedException('Compte de l’équipe : connectez-vous au back-office');
    return this.session(u);
  }

  async updateProfile(id: string, dto: ProfileDto) {
    const u = await this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id }).getOne();
    if (!u) throw new NotFoundException();
    if (dto.name) u.name = dto.name.trim();
    if (dto.avatarUrl) u.avatarUrl = dto.avatarUrl;
    if (dto.newPassword) {
      if (!dto.currentPassword || !(await bcrypt.compare(dto.currentPassword, u.passwordHash))) throw new BadRequestException('Mot de passe actuel incorrect');
      u.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }
    await this.users.save(u);
    return this.me(id);
  }

  // ---------- Adresses ----------

  async addAddress(id: string, dto: AddressDto) {
    const u = await this.users.findOneBy({ id });
    if (u.addresses.length >= 20) throw new BadRequestException('20 adresses maximum');
    u.addresses = [...u.addresses, { id: randomUUID(), label: dto.label.trim(), address: dto.address.trim(), landmark: dto.landmark?.trim() || null, lat: dto.lat, lng: dto.lng }];
    await this.users.save(u);
    return this.me(id);
  }

  async removeAddress(id: string, addressId: string) {
    const u = await this.users.findOneBy({ id });
    u.addresses = u.addresses.filter((a) => a.id !== addressId);
    await this.users.save(u);
    return this.me(id);
  }

  // ---------- Statut revendeur ----------

  async requestReseller(id: string, dto: ResellerDto) {
    const u = await this.users.findOneBy({ id });
    if (u.resellerStatus === ResellerStatus.APPROVED) throw new BadRequestException('Vous êtes déjà revendeur');
    if (u.resellerStatus === ResellerStatus.PENDING) throw new BadRequestException('Demande déjà en cours de vérification');
    u.reseller = { businessName: dto.businessName.trim(), commune: dto.commune?.trim() || null, idPhotoUrl: dto.idPhotoUrl, shopPhotoUrl: dto.shopPhotoUrl, submittedAt: new Date().toISOString() };
    u.resellerStatus = ResellerStatus.PENDING;
    await this.users.save(u);
    return this.me(id);
  }
}
