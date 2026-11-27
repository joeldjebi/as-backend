import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { Product, ProductStatus } from '../products/product.entity';
import { Shop, ShopStatus } from '../shops/shop.entity';
import { User } from '../users/user.entity';
import { LetoDelivery, LetoError, LetoService } from './leto.service';
import { Order, OrderAddress, OrderItem, OrderStatus } from './order.entity';

export interface CheckoutInput {
  items: { productId: string; variantId?: string | null; qty: number }[];
  addressId?: string;
  address?: OrderAddress;
  recipientName?: string;
  recipientPhone?: string;
  note?: string;
}

/** Statuts VITE → libellé client (suivi) */
const DELIVERY_LABEL: Record<string, string> = {
  PENDING: 'Recherche d’un livreur',
  ACCEPTED: 'Livreur en route vers la boutique',
  PICKED_UP: 'Colis récupéré, en route vers vous',
  DELIVERED: 'Livré',
  CANCELLED: 'Course annulée',
};

const REFRESH_EVERY_MS = 20_000;

@Injectable()
export class OrdersService {
  private logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private repo: Repository<Order>,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(Shop) private shops: Repository<Shop>,
    @InjectRepository(User) private users: Repository<User>,
    private leto: LetoService,
    private db: DataSource,
  ) {}

  // ---------- Vues ----------

  view(o: Order) {
    return {
      ...o,
      number: o.number,
      deliveryLabel: o.delivery?.status ? (DELIVERY_LABEL[o.delivery.status] ?? o.delivery.status) : null,
    };
  }

  private log(o: Order, status: OrderStatus | string, by?: string, note?: string) {
    o.history = [...(o.history ?? []), { at: new Date().toISOString(), status, ...(by ? { by } : {}), ...(note ? { note } : {}) }];
  }

  /** Bénéficiaire du paiement : la boutique (alias PI-SPI) ou Adjamé-Smart */
  private payee(shop: Shop) {
    if (shop.payoutMode === 'DIRECT' && shop.pispiAlias) return { mode: 'DIRECT' as const, alias: shop.pispiAlias, payee: shop.name };
    return { mode: 'PLATFORM' as const, alias: process.env.AS_PISPI_ALIAS || null, payee: process.env.AS_PISPI_NAME || 'Adjamé-Smart' };
  }

  // ---------- Client ----------

  /** Devis : montants par boutique et estimation des frais de livraison VITE */
  async quote(userId: string, dto: CheckoutInput) {
    const { groups, address } = await this.prepare(userId, dto, false);
    const lines = await Promise.all(
      groups.map(async (g) => ({
        shopId: g.shop.id,
        shopName: g.shop.name,
        goodsTotal: g.goodsTotal,
        dueNow: g.dueNow,
        dueOnDelivery: g.goodsTotal - g.dueNow,
        deliveryFeeEstimate: address && g.shop.lat != null ? await this.leto.quote({ lat: g.shop.lat, lng: g.shop.lng! }, { lat: address.lat, lng: address.lng, codAmount: g.goodsTotal - g.dueNow }) : null,
        payment: this.payee(g.shop),
      })),
    );
    return {
      shops: lines,
      goodsTotal: lines.reduce((t, l) => t + l.goodsTotal, 0),
      dueNow: lines.reduce((t, l) => t + l.dueNow, 0),
      dueOnDelivery: lines.reduce((t, l) => t + l.dueOnDelivery, 0),
      deliveryFeeEstimate: lines.every((l) => l.deliveryFeeEstimate != null) ? lines.reduce((t, l) => t + (l.deliveryFeeEstimate ?? 0), 0) : null,
    };
  }

  /** Vérifie le panier avec les prix et stocks du serveur, regroupé par boutique */
  private async prepare(userId: string, dto: CheckoutInput, needAddress: boolean) {
    if (!dto.items?.length) throw new BadRequestException('Votre panier est vide');
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new ForbiddenException();
    let address: OrderAddress | null = null;
    if (dto.addressId) {
      const a = user.addresses.find((x) => x.id === dto.addressId);
      if (!a) throw new BadRequestException('Adresse introuvable : choisissez-en une autre');
      address = { label: a.label, address: a.address, landmark: a.landmark, lat: a.lat, lng: a.lng };
    } else if (dto.address) {
      address = dto.address;
    }
    if (needAddress && !address) throw new BadRequestException('Choisissez une adresse de livraison');

    const products = await this.products.findBy({ id: In(dto.items.map((i) => i.productId)) });
    const shops = await this.shops.findBy({ id: In([...new Set(products.map((p) => p.shopId))].concat('00000000-0000-0000-0000-000000000000')) });
    const byShop = new Map<string, { shop: Shop; items: OrderItem[]; goodsTotal: number; dueNow: number; products: Product[] }>();
    for (const line of dto.items) {
      const p = products.find((x) => x.id === line.productId);
      const shop = p && shops.find((s) => s.id === p.shopId);
      if (!p || !shop || p.status !== ProductStatus.ACTIVE || shop.status !== ShopStatus.APPROVED) {
        throw new BadRequestException(`Un article n’est plus disponible${p ? ` : ${p.name}` : ''}. Retirez-le du panier.`);
      }
      const qty = Math.max(1, Math.floor(line.qty));
      const v = line.variantId ? p.variants.find((x) => x.id === line.variantId) : null;
      if (line.variantId && !v) throw new BadRequestException(`L’option choisie pour « ${p.name} » n’existe plus`);
      if (!v && p.variants.length) throw new BadRequestException(`Choisissez une option pour « ${p.name} »`);
      const stock = v ? v.stock : p.stock;
      if (stock != null && stock < qty) throw new BadRequestException(stock <= 0 ? `« ${p.name} » est épuisé` : `Plus que ${stock} « ${p.name} » en stock`);
      const price = v?.price ?? p.price;
      const pct = p.prepayPercent ?? shop.prepayPercent ?? 100;
      const subtotal = price * qty;
      const dueNow = pct >= 100 ? subtotal : Math.round((subtotal * pct) / 100);
      const g = byShop.get(shop.id) ?? { shop, items: [], goodsTotal: 0, dueNow: 0, products: [] };
      g.items.push({ productId: p.id, variantId: v?.id ?? null, name: p.name, variantLabel: v?.label ?? null, photo: p.photos[0] ?? null, price, qty, prepayPercent: pct, subtotal, dueNow });
      g.goodsTotal += subtotal;
      g.dueNow += dueNow;
      g.products.push(p);
      byShop.set(shop.id, g);
    }
    return { user, address, groups: [...byShop.values()] };
  }

  /** Commande : une par boutique, stock réservé, en attente du paiement */
  async checkout(userId: string, dto: CheckoutInput) {
    const { user, address, groups } = await this.prepare(userId, dto, true);
    const recipientName = dto.recipientName?.trim() || user.name;
    const recipientPhone = dto.recipientPhone?.trim() || user.phone;
    const checkoutId = randomUUID();
    // Estimation des frais de livraison (hors transaction : appel réseau)
    const fees = await Promise.all(groups.map((g) => (g.shop.lat != null ? this.leto.quote({ lat: g.shop.lat, lng: g.shop.lng! }, { lat: address!.lat, lng: address!.lng, codAmount: g.goodsTotal - g.dueNow }) : Promise.resolve(null))));
    const created = await this.db.transaction(async (m) => {
      const out: Order[] = [];
      for (const [i, g] of groups.entries()) {
        // Réserve le stock (les quantités suivies diminuent tout de suite, rendues si la commande est annulée)
        for (const it of g.items) await this.moveStock(m.getRepository(Product), it, -it.qty);
        const fee = fees[i];
        const o = m.getRepository(Order).create({
          checkoutId, customerId: user.id, shopId: g.shop.id, shopName: g.shop.name, items: g.items,
          goodsTotal: g.goodsTotal, dueNow: g.dueNow, dueOnDelivery: g.goodsTotal - g.dueNow, deliveryFeeEstimate: fee,
          address: address!, recipientName, recipientPhone, note: dto.note?.trim() || null,
          status: OrderStatus.AWAITING_PAYMENT, payment: this.payee(g.shop), delivery: {}, history: [],
        });
        this.log(o, OrderStatus.AWAITING_PAYMENT, user.name);
        out.push(await m.getRepository(Order).save(o));
      }
      return out;
    });
    return { checkoutId, orders: created.map((o) => this.view(o)) };
  }

  private async moveStock(repo: Repository<Product>, it: OrderItem, delta: number) {
    const p = await repo.findOne({ where: { id: it.productId }, lock: { mode: 'pessimistic_write' } });
    if (!p) return;
    if (it.variantId) {
      const v = p.variants.find((x) => x.id === it.variantId);
      if (!v || v.stock == null) return;
      if (v.stock + delta < 0) throw new BadRequestException(`Stock insuffisant pour « ${p.name} »`);
      p.variants = p.variants.map((x) => (x.id === v.id ? { ...x, stock: x.stock! + delta } : x));
    } else {
      if (p.stock == null) return;
      if (p.stock + delta < 0) throw new BadRequestException(`Stock insuffisant pour « ${p.name} »`);
      p.stock += delta;
    }
    await repo.save(p);
  }

  async mine(userId: string) {
    const rows = await this.repo.find({ where: { customerId: userId }, order: { createdAt: 'DESC' }, take: 100 });
    return rows.map((o) => this.view(o));
  }

  async oneForCustomer(userId: string, id: string) {
    const o = await this.repo.findOneBy({ id });
    if (!o || o.customerId !== userId) throw new NotFoundException('Commande introuvable');
    return this.view(await this.refreshDelivery(o));
  }

  /** Le client indique qu'il a payé (référence de la transaction Mobile Money) */
  async declarePayment(userId: string, id: string, reference: string, payerPhone?: string) {
    const o = await this.repo.findOneBy({ id });
    if (!o || o.customerId !== userId) throw new NotFoundException('Commande introuvable');
    if (o.status !== OrderStatus.AWAITING_PAYMENT && o.status !== OrderStatus.PAYMENT_DECLARED) throw new BadRequestException('Paiement déjà traité');
    o.payment = { ...o.payment, reference: reference.trim(), payerPhone: payerPhone?.trim() || null, declaredAt: new Date().toISOString(), rejectedNote: null };
    o.status = OrderStatus.PAYMENT_DECLARED;
    this.log(o, o.status, 'Client', `Réf. ${reference.trim()}`);
    return this.view(await this.repo.save(o));
  }

  async cancelByCustomer(userId: string, id: string) {
    const o = await this.repo.findOneBy({ id });
    if (!o || o.customerId !== userId) throw new NotFoundException('Commande introuvable');
    if (o.status !== OrderStatus.AWAITING_PAYMENT) throw new BadRequestException('Paiement déjà envoyé : contactez la boutique pour annuler');
    return this.view(await this.cancel(o, 'Client', 'Annulée par le client'));
  }

  private async cancel(o: Order, by: string, reason: string) {
    await this.db.transaction(async (m) => {
      for (const it of o.items) await this.moveStock(m.getRepository(Product), it, it.qty).catch(() => undefined);
    });
    o.status = OrderStatus.CANCELLED;
    o.cancelReason = reason;
    this.log(o, o.status, by, reason);
    return this.repo.save(o);
  }

  // ---------- Boutique ----------

  private async ownShop(userId: string, shopId: string) {
    const s = await this.shops.findOneBy({ id: shopId });
    if (!s || s.ownerId !== userId) throw new ForbiddenException();
    return s;
  }

  async forShop(userId: string, shopId: string) {
    await this.ownShop(userId, shopId);
    const rows = await this.repo.find({ where: { shopId }, order: { createdAt: 'DESC' }, take: 200 });
    return rows.map((o) => this.view(o));
  }

  private async shopOrder(userId: string, id: string) {
    const o = await this.repo.findOneBy({ id });
    if (!o) throw new NotFoundException('Commande introuvable');
    const shop = await this.ownShop(userId, o.shopId);
    return { o, shop };
  }

  /** La boutique confirme avoir reçu le paiement (encaissement direct) : la course VITE part */
  async shopConfirmPayment(userId: string, id: string) {
    const { o, shop } = await this.shopOrder(userId, id);
    if (o.payment.mode !== 'DIRECT') throw new BadRequestException('Ce paiement est reçu par Adjamé-Smart : il sera confirmé par l’équipe');
    return this.confirmPayment(o, shop.name);
  }

  async shopRejectPayment(userId: string, id: string, note: string) {
    const { o, shop } = await this.shopOrder(userId, id);
    if (o.payment.mode !== 'DIRECT') throw new BadRequestException('Ce paiement est vérifié par Adjamé-Smart');
    return this.rejectPayment(o, shop.name, note);
  }

  async shopCancel(userId: string, id: string, reason: string) {
    const { o, shop } = await this.shopOrder(userId, id);
    if (![OrderStatus.AWAITING_PAYMENT, OrderStatus.PAYMENT_DECLARED, OrderStatus.PAID].includes(o.status)) throw new BadRequestException('Livraison déjà lancée : annulation impossible');
    return this.view(await this.cancel(o, shop.name, reason.trim()));
  }

  async shopRetryDelivery(userId: string, id: string) {
    const { o } = await this.shopOrder(userId, id);
    return this.view(await this.requestDelivery(o));
  }

  // ---------- Équipe ----------

  async adminList(status?: OrderStatus) {
    const rows = await this.repo.find({ where: status ? { status } : {}, order: { createdAt: 'DESC' }, take: 300 });
    const [counts] = await this.repo.query(
      `SELECT count(*) FILTER (WHERE status = 'PAYMENT_DECLARED' AND payment->>'mode' = 'PLATFORM')::int AS "toConfirm",
              count(*) FILTER (WHERE status = 'PAID')::int AS "toDeliver",
              count(*) FILTER (WHERE status = 'IN_DELIVERY')::int AS "inDelivery",
              count(*)::int AS total FROM orders`,
    );
    return { counts, items: rows.map((o) => this.view(o)) };
  }

  async adminConfirmPayment(id: string, by: string) {
    const o = await this.repo.findOneBy({ id });
    if (!o) throw new NotFoundException('Commande introuvable');
    return this.confirmPayment(o, by);
  }

  async adminRejectPayment(id: string, by: string, note: string) {
    const o = await this.repo.findOneBy({ id });
    if (!o) throw new NotFoundException('Commande introuvable');
    return this.rejectPayment(o, by, note);
  }

  async adminRetryDelivery(id: string) {
    const o = await this.repo.findOneBy({ id });
    if (!o) throw new NotFoundException('Commande introuvable');
    return this.view(await this.requestDelivery(o));
  }

  async adminCancel(id: string, by: string, reason: string) {
    const o = await this.repo.findOneBy({ id });
    if (!o) throw new NotFoundException('Commande introuvable');
    if (o.status === OrderStatus.IN_DELIVERY || o.status === OrderStatus.DELIVERED) throw new BadRequestException('Livraison déjà lancée : annulez la course dans VITE');
    return this.view(await this.cancel(o, by, reason.trim()));
  }

  // ---------- Paiement et livraison ----------

  private async confirmPayment(o: Order, by: string) {
    if (o.status !== OrderStatus.AWAITING_PAYMENT && o.status !== OrderStatus.PAYMENT_DECLARED) throw new BadRequestException('Paiement déjà traité');
    o.payment = { ...o.payment, confirmedAt: new Date().toISOString(), confirmedBy: by };
    o.status = OrderStatus.PAID;
    this.log(o, o.status, by, 'Paiement reçu');
    await this.repo.save(o);
    return this.view(await this.requestDelivery(o));
  }

  private async rejectPayment(o: Order, by: string, note: string) {
    if (o.status !== OrderStatus.PAYMENT_DECLARED) throw new BadRequestException('Aucun paiement à vérifier');
    o.payment = { ...o.payment, rejectedNote: note.trim(), declaredAt: null };
    o.status = OrderStatus.AWAITING_PAYMENT;
    this.log(o, 'PAYMENT_REJECTED', by, note.trim());
    return this.view(await this.repo.save(o));
  }

  /**
   * Lance la course VITE : départ = boutique, arrivée = client ; le livreur encaisse le reste de la marchandise
   * (codAmount) et ses frais (payés par le destinataire). En cas d'échec, la commande reste « payée » et peut être relancée.
   */
  private async requestDelivery(o: Order): Promise<Order> {
    if (o.status !== OrderStatus.PAID) throw new BadRequestException('Le paiement doit être confirmé avant la livraison');
    const shop = await this.shops.findOneBy({ id: o.shopId });
    if (!shop || shop.lat == null || shop.lng == null || !shop.phone) {
      o.delivery = { ...o.delivery, error: 'Adresse ou téléphone de la boutique manquant' };
      return this.repo.save(o);
    }
    try {
      const d = await this.leto.create(
        {
          reference: o.number,
          vehicleType: 'MOTO',
          speed: 'STANDARD',
          pickup: { lat: shop.lat, lng: shop.lng, address: [shop.location, shop.market, 'Adjamé'].filter(Boolean).join(', '), phone: shop.phone, contactName: shop.name },
          stops: [{
            lat: o.address.lat, lng: o.address.lng,
            address: o.address.address || o.address.label,
            details: o.address.landmark ?? undefined,
            recipientName: o.recipientName,
            recipientPhone: o.recipientPhone,
            codAmount: o.dueOnDelivery,
            packageDescription: o.items.map((i) => `${i.qty} × ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''}`).join(', ').slice(0, 300),
          }],
          comment: [`Commande Adjamé-Smart ${o.number}`, o.note].filter(Boolean).join(' — ').slice(0, 500),
          feePaidBy: 'RECIPIENT',
        },
        // Une clé par tentative : une relance après annulation crée une nouvelle course
        `${o.id}:${(o.delivery?.attempts ?? 0) + 1}`,
      );
      o.delivery = { ...o.delivery, attempts: (o.delivery?.attempts ?? 0) + 1 };
      this.applyDelivery(o, d);
      o.delivery.requestedAt = new Date().toISOString();
      o.delivery.error = null;
      o.status = OrderStatus.IN_DELIVERY;
      this.log(o, o.status, 'VITE', 'Course de livraison créée');
    } catch (e) {
      o.delivery = { ...o.delivery, error: e instanceof LetoError ? e.message : 'Création de la course impossible pour le moment' };
      this.logger.warn(`Course VITE non créée pour ${o.number} : ${(e as Error).message}`);
    }
    return this.repo.save(o);
  }

  private applyDelivery(o: Order, d: LetoDelivery) {
    const stop = d.stops?.[0];
    o.delivery = {
      ...o.delivery,
      deliveryId: d.id,
      status: d.status,
      stopStatus: stop?.status ?? null,
      trackingUrl: d.trackingUrl,
      price: d.price,
      confirmationCode: stop?.confirmationCode ?? o.delivery?.confirmationCode ?? null,
      driver: d.driver ? { name: d.driver.name, phone: d.driver.phone ?? null, vehicleType: d.driver.vehicleType, plate: d.driver.plate ?? null } : null,
      updatedAt: new Date().toISOString(),
    };
    if (stop?.status === 'DELIVERED' && o.status !== OrderStatus.DELIVERED) {
      o.status = OrderStatus.DELIVERED;
      this.log(o, o.status, 'VITE', 'Colis remis au client');
    } else if (stop?.status === 'FAILED' && o.status === OrderStatus.IN_DELIVERY) {
      o.status = OrderStatus.FAILED;
      this.log(o, o.status, 'VITE', 'Livraison impossible (client absent ou refus)');
    } else if (d.status === 'CANCELLED' && o.status === OrderStatus.IN_DELIVERY) {
      // Course annulée côté VITE : la commande redevient « payée », on peut relancer une course
      o.status = OrderStatus.PAID;
      o.delivery.error = 'Course annulée par VITE : relancez la livraison';
      this.log(o, o.status, 'VITE', 'Course annulée');
    }
  }

  /** Mise à jour depuis VITE à la consultation (si le dernier état date de plus de 20 s) */
  private async refreshDelivery(o: Order) {
    if (o.status !== OrderStatus.IN_DELIVERY || !o.delivery?.deliveryId || !this.leto.configured) return o;
    if (o.delivery.updatedAt && Date.now() - Date.parse(o.delivery.updatedAt) < REFRESH_EVERY_MS) return o;
    try {
      this.applyDelivery(o, await this.leto.get(o.delivery.deliveryId));
      return this.repo.save(o);
    } catch {
      return o;
    }
  }

  /** Webhook VITE (signature vérifiée par le contrôleur) */
  async onWebhook(body: { id?: string; event?: string; delivery?: LetoDelivery }) {
    const d = body.delivery;
    if (!d?.id) return { ok: true };
    const o = (await this.repo.createQueryBuilder('o').where(`o.delivery->>'deliveryId' = :id`, { id: d.id }).getOne())
      ?? (d.reference ? await this.repo.findOneBy({ seq: Number(d.reference.replace(/^AS-/, '')) - 1000 }) : null);
    if (!o) return { ok: true };
    if (body.id && o.delivery?.events?.includes(body.id)) return { ok: true, duplicate: true };
    this.applyDelivery(o, d);
    o.delivery.events = [...(o.delivery.events ?? []), ...(body.id ? [body.id] : [])].slice(-50);
    await this.repo.save(o);
    return { ok: true };
  }
}
