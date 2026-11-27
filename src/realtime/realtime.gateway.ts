import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/decorators';
import { Shop } from '../shops/shop.entity';
import { Role } from '../users/user.entity';

/** Notification à afficher (notification locale, Live Activity, bandeau web) */
export interface Notice { title: string; body: string }

/**
 * Temps réel (Socket.IO) : les écrans se mettent à jour seuls, sans actualiser.
 *
 * Salles : `user:<id>` (client), `shop:<id>` (boutique, son propriétaire), `admin` (équipe Adjamé-Smart).
 * Événements :
 *  - `order:changed` { id, number, status, deliveryStatus, notice? } → l'écran relit la commande
 *  - `order:offers`  { id, number, notice? } → un livreur propose un prix (le client relit les propositions)
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;
  private logger = new Logger(RealtimeGateway.name);

  constructor(
    private jwt: JwtService,
    @InjectRepository(Shop) private shops: Repository<Shop>,
  ) {}

  /** Connexion acceptée seulement avec un jeton valide ; chacun rejoint ses salles */
  afterInit(server: Server) {
    server.use(async (socket: Socket, next) => {
      try {
        const raw = (socket.handshake.auth?.token as string | undefined) ?? (socket.handshake.query?.token as string | undefined) ?? '';
        const user = await this.jwt.verifyAsync<AuthUser>(raw.replace(/^Bearer /, ''));
        await socket.join(`user:${user.sub}`);
        if (user.role === Role.ADMIN) await socket.join('admin');
        const owned = await this.shops.find({ where: { ownerId: user.sub }, select: { id: true } });
        for (const s of owned) await socket.join(`shop:${s.id}`);
        next();
      } catch {
        next(new Error('Session expirée'));
      }
    });
  }

  emit(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }

  /** Une boutique vient d'être créée : son propriétaire, déjà connecté, rejoint sa salle */
  async joinShop(ownerId: string, shopId: string) {
    const sockets = await this.server?.in(`user:${ownerId}`).fetchSockets();
    for (const s of sockets ?? []) s.join(`shop:${shopId}`);
  }
}
