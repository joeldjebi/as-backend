import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser, Public, Roles, Staff } from '../common/decorators';
import { IsPhone, PHONE_MESSAGE } from '../countries/phone';
import { Role, StaffRole, User } from '../users/user.entity';
import { LetoService } from './leto.service';
import { OrderStatus } from './order.entity';
import { OrdersService } from './orders.service';

class ItemDto {
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() variantId?: string | null;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000) qty: number;
}
class AddressDto {
  @IsString() @MaxLength(60) label: string;
  @IsString() @MaxLength(200) address: string;
  @IsOptional() @IsString() @MaxLength(200) landmark: string | null;
  @Type(() => Number) @IsLatitude() lat: number;
  @Type(() => Number) @IsLongitude() lng: number;
}
class CheckoutDto {
  @IsArray() @ArrayMinSize(1, { message: 'Votre panier est vide' }) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ItemDto) items: ItemDto[];
  @IsOptional() @IsString() @MaxLength(40) addressId?: string;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto;
  @IsOptional() @IsString() @MaxLength(100) recipientName?: string;
  @IsPhone({ optional: true, message: `Téléphone du destinataire : ${PHONE_MESSAGE}` }) recipientPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsIn(['MOTO', 'CAR', 'CARGO'], { message: 'Engin inconnu' }) vehicleType?: 'MOTO' | 'CAR' | 'CARGO';
  @IsOptional() @IsIn(['EXPRESS', 'STANDARD', 'SCHEDULED'], { message: 'Délai inconnu' }) speed?: 'EXPRESS' | 'STANDARD' | 'SCHEDULED';
}
class PriceDto {
  @Type(() => Number) @IsInt() @Min(1) price: number;
}
class DeclareDto {
  @IsString() @IsNotEmpty({ message: 'Indiquez la référence de la transaction' }) @MaxLength(80) reference: string;
  @IsPhone({ optional: true, message: `Numéro qui a payé : ${PHONE_MESSAGE}` }) payerPhone?: string;
}
class NoteDto {
  @IsString() @IsNotEmpty({ message: 'Motif obligatoire' }) @MaxLength(300) note: string;
}
class StatusQuery {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
}

@Controller('orders')
export class OrdersController {
  constructor(private service: OrdersService, private leto: LetoService, @InjectRepository(User) private users: Repository<User>) {}

  private async by(u: AuthUser) {
    return (await this.users.findOneBy({ id: u.sub }))?.name ?? 'Équipe';
  }

  // ----- Client -----
  @Post('quote')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  quote(@CurrentUser() u: AuthUser, @Body() dto: CheckoutDto) {
    return this.service.quote(u.sub, dto);
  }

  @Post()
  @Roles(Role.CUSTOMER)
  checkout(@CurrentUser() u: AuthUser, @Body() dto: CheckoutDto) {
    return this.service.checkout(u.sub, dto);
  }

  @Get('mine')
  @Roles(Role.CUSTOMER)
  mine(@CurrentUser() u: AuthUser) {
    return this.service.mine(u.sub);
  }

  @Get('mine/:id/track')
  @Roles(Role.CUSTOMER)
  track(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.trackForCustomer(u.sub, id);
  }

  // Négociation du prix de livraison avec les livreurs VITE
  @Get('mine/:id/offers')
  @Roles(Role.CUSTOMER)
  offers(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.offersForCustomer(u.sub, id);
  }

  @Post('mine/:id/offers/:offerId/accept')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  acceptOffer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.service.acceptOffer(u.sub, id, offerId);
  }

  @Post('mine/:id/offers/:offerId/decline')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  declineOffer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.service.declineOffer(u.sub, id, offerId);
  }

  @Post('mine/:id/offers/:offerId/counter')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  counterOffer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('offerId', ParseUUIDPipe) offerId: string, @Body() dto: PriceDto) {
    return this.service.counterOffer(u.sub, id, offerId, dto.price);
  }

  @Post('mine/:id/payment')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  declare(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclareDto) {
    return this.service.declarePayment(u.sub, id, dto.reference, dto.payerPhone);
  }

  @Post('mine/:id/cancel')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancelByCustomer(u.sub, id);
  }

  // ----- Boutique -----
  @Get('shop')
  @Roles(Role.CUSTOMER)
  forShop(@CurrentUser() u: AuthUser, @Query('shopId', ParseUUIDPipe) shopId: string) {
    return this.service.forShop(u.sub, shopId);
  }

  @Post('shop/:id/confirm-payment')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  shopConfirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.shopConfirmPayment(u.sub, id);
  }

  @Post('shop/:id/reject-payment')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  shopReject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.service.shopRejectPayment(u.sub, id, dto.note);
  }

  @Post('shop/:id/cancel')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  shopCancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.service.shopCancel(u.sub, id, dto.note);
  }

  @Post('shop/:id/retry-delivery')
  @HttpCode(200)
  @Roles(Role.CUSTOMER)
  shopRetry(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.shopRetryDelivery(u.sub, id);
  }

  // ----- Équipe -----
  @Get('admin')
  @Roles(Role.ADMIN)
  adminList(@Query() q: StatusQuery) {
    return this.service.adminList(q.status);
  }

  @Post('admin/:id/confirm-payment')
  @HttpCode(200)
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.SUPPORT)
  async adminConfirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.adminConfirmPayment(id, await this.by(u));
  }

  @Post('admin/:id/reject-payment')
  @HttpCode(200)
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.SUPPORT)
  async adminReject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.service.adminRejectPayment(id, await this.by(u), dto.note);
  }

  @Post('admin/:id/retry-delivery')
  @HttpCode(200)
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.SUPPORT)
  adminRetry(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.adminRetryDelivery(id);
  }

  @Post('admin/:id/cancel')
  @HttpCode(200)
  @Staff(StaffRole.SUPER_ADMIN, StaffRole.SUPPORT)
  async adminCancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.service.adminCancel(id, await this.by(u), dto.note);
  }

  /** Client : une commande (avec suivi de la course). Après les routes « shop » et « admin ». */
  @Get(':id')
  @Roles(Role.CUSTOMER)
  one(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.oneForCustomer(u.sub, id);
  }
}

/** Adresse de livraison : recherche de quartier et vérification du point (service d'adresses de VITE) */
@Controller('geo')
export class GeoController {
  constructor(private leto: LetoService) {}

  @Get('search')
  @Roles(Role.CUSTOMER)
  async search(@Query('q') q = '', @Query('lat') lat?: string, @Query('lng') lng?: string) {
    const text = String(q).trim().slice(0, 120);
    if (text.length < 2) return [];
    const near = lat && lng && Number.isFinite(+lat) && Number.isFinite(+lng) ? { lat: +lat, lng: +lng } : undefined;
    return this.leto.geoSearch(text, near).catch(() => []);
  }

  @Get('reverse')
  @Roles(Role.CUSTOMER)
  reverse(@Query('lat') lat: string, @Query('lng') lng: string) {
    if (!Number.isFinite(+lat) || !Number.isFinite(+lng) || !lat || !lng) return null;
    return this.leto.geoReverse(+lat, +lng).catch(() => null);
  }
}

/** Événements de livraison envoyés par VITE (signés) */
@Controller('webhooks')
export class LetoWebhookController {
  constructor(private service: OrdersService, private leto: LetoService) {}

  @Public()
  @Post('leto')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>, @Headers('x-leto-signature') sig: string | undefined, @Body() body: Record<string, unknown>) {
    if (!this.leto.verify(sig, req.rawBody)) throw new UnauthorizedException('Signature invalide');
    return this.service.onWebhook(body as Parameters<OrdersService['onWebhook']>[0]);
  }
}
