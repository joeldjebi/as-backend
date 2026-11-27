import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, InsertEvent, UpdateEvent } from 'typeorm';
import { Order, OrderStatus } from '../orders/order.entity';
import { Notice, RealtimeGateway } from './realtime.gateway';

const num = (o: Order) => `AS-${o.seq + 1000}`;

/**
 * Chaque enregistrement d'une commande (client, boutique, équipe, webhook VITE) est diffusé en temps réel,
 * avec une notification adaptée à chacun quand l'étape change.
 */
@Injectable()
export class OrderSubscriber implements EntitySubscriberInterface<Order> {
  constructor(
    db: DataSource,
    private rt: RealtimeGateway,
  ) {
    db.subscribers.push(this);
  }

  listenTo() {
    return Order;
  }

  afterInsert(e: InsertEvent<Order>) {
    const o = e.entity;
    this.send(o, null, { title: `Nouvelle commande ${num(o)}`, body: `${o.items.length} article(s) · paiement en attente` }, null);
  }

  afterUpdate(e: UpdateEvent<Order>) {
    const o = e.entity as Order | undefined;
    if (!o?.id) return;
    const before = e.databaseEntity as Order | undefined;
    const was = { status: before?.status, delivery: before?.delivery?.status ?? null };
    const now = { status: o.status, delivery: o.delivery?.status ?? null };
    const n = num(o);
    let customer: Notice | null = null;
    let shop: Notice | null = null;
    let admin: Notice | null = null;
    if (was.status !== now.status) {
      switch (now.status) {
        case OrderStatus.PAYMENT_DECLARED:
          if (o.payment?.mode === 'DIRECT') shop = { title: `Paiement à vérifier · ${n}`, body: `Référence ${o.payment.reference ?? ''} : confirmez la réception pour lancer la livraison.` };
          else admin = { title: `Paiement à vérifier · ${n}`, body: `${o.shopName} · référence ${o.payment?.reference ?? ''}` };
          break;
        case OrderStatus.PAID:
          customer = { title: 'Paiement confirmé', body: `Nous recherchons un livreur pour votre commande ${n}.` };
          shop = { title: `Commande payée · ${n}`, body: 'Préparez le colis : un livreur VITE arrive bientôt.' };
          break;
        case OrderStatus.AWAITING_PAYMENT:
          if (o.payment?.rejectedNote) customer = { title: 'Référence à vérifier', body: `Vérifiez la référence de votre paiement pour ${n}.` };
          break;
        case OrderStatus.DELIVERED:
          customer = { title: 'Commande livrée', body: `Merci pour votre achat chez ${o.shopName} !` };
          shop = { title: `Commande livrée · ${n}`, body: 'Le client a reçu son colis.' };
          break;
        case OrderStatus.CANCELLED:
          customer = { title: 'Commande annulée', body: o.cancelReason ?? `Votre commande ${n} est annulée.` };
          shop = { title: `Commande annulée · ${n}`, body: o.cancelReason ?? 'Les articles sont remis en stock.' };
          break;
        case OrderStatus.FAILED:
          customer = { title: 'Livraison à reprogrammer', body: `${o.shopName} vous contacte pour un nouveau passage.` };
          shop = { title: `Livraison à reprogrammer · ${n}`, body: 'Contactez le client pour un nouveau passage.' };
          break;
      }
    }
    if (was.delivery !== now.delivery && now.status === OrderStatus.IN_DELIVERY) {
      const driver = o.delivery?.driver?.name ?? 'Un livreur VITE';
      if (now.delivery === 'ACCEPTED') {
        customer = { title: 'Un livreur arrive', body: `${driver} va récupérer votre colis chez ${o.shopName}.` };
        shop = { title: `Livreur en route · ${n}`, body: `${driver} arrive pour récupérer le colis.` };
      } else if (now.delivery === 'PICKED_UP') {
        customer = { title: 'Votre colis est en route', body: `${driver} vous apporte votre commande ${n}.` };
      }
    }
    this.send(o, customer, shop, admin);
  }

  private send(o: Order, customer: Notice | null, shop: Notice | null, admin: Notice | null) {
    const base = { id: o.id, number: num(o), status: o.status, deliveryStatus: o.delivery?.status ?? null };
    // Après la validation de la transaction : les écrans relisent une commande à jour
    setTimeout(() => {
      this.rt.emit(`user:${o.customerId}`, 'order:changed', { ...base, notice: customer });
      this.rt.emit(`shop:${o.shopId}`, 'order:changed', { ...base, notice: shop });
      this.rt.emit('admin', 'order:changed', { ...base, notice: admin });
    }, 300);
  }
}
