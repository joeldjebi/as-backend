import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role, StaffRole, User } from '../users/user.entity';
import { IS_PUBLIC, ROLES, STAFF } from './decorators';

/** Guard global : token JWT, compte actif, puis rôle (@Roles) et rôle d'équipe (@Staff) */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, @InjectRepository(User) private users: Repository<User>) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const [type, token] = (req.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();
    try {
      req.user = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }
    // Compte désactivé par l'équipe : accès coupé immédiatement
    const user = await this.users.findOneBy({ id: req.user.sub });
    if (!user || !user.active) throw new UnauthorizedException('Compte désactivé');
    req.account = user;
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException('Accès non autorisé pour ce rôle');
    const staff = this.reflector.getAllAndOverride<StaffRole[]>(STAFF, targets);
    if (staff?.length && (user.role !== Role.ADMIN || !user.staffRole || !staff.includes(user.staffRole))) {
      throw new ForbiddenException('Action réservée à un autre rôle de l’équipe');
    }
    return true;
  }
}
