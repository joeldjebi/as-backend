import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role, StaffRole } from '../users/user.entity';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const STAFF = 'staffRoles';

/** Route accessible sans connexion */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route réservée à certains rôles (CUSTOMER : client et vendeur ; ADMIN : équipe Adjamé-Smart) */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Équipe : rôles autorisés (super admin, modérateur, support) */
export const Staff = (...roles: StaffRole[]) => SetMetadata(STAFF, roles);

export interface AuthUser {
  sub: string;
  role: Role;
}

/** Utilisateur connecté (contenu du token JWT) */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
