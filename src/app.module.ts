import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { readFileSync } from 'fs';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CategoriesController, CategoriesService } from './categories/categories.controller';
import { Category } from './categories/category.entity';
import { AuthGuard } from './common/auth.guard';
import { Order } from './orders/order.entity';
import { LetoService } from './orders/leto.service';
import { LetoWebhookController, OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { Product } from './products/product.entity';
import { SettingsController } from './settings/settings.controller';
import { Setting, SettingsService } from './settings/settings.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { Shop } from './shops/shop.entity';
import { ShopsController } from './shops/shops.controller';
import { ShopsService } from './shops/shops.service';
import { StorageService } from './storage/storage.service';
import { UploadsController } from './uploads/uploads.controller';
import { User } from './users/user.entity';

// .env lu au démarrage (sans dépendance) : les variables déjà définies gardent la priorité
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* pas de .env : variables d'environnement seulement */
}

const entities = [User, Category, Shop, Product, Order, Setting];

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME ?? 'adjame_smart',
      entities,
      synchronize: process.env.DB_SYNC !== 'false',
    }),
    TypeOrmModule.forFeature(entities),
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET || 'adjame-dev', signOptions: { expiresIn: '60d' } }),
  ],
  controllers: [AuthController, CategoriesController, ShopsController, AdminController, UploadsController, ProductsController, OrdersController, LetoWebhookController, SettingsController],
  providers: [AuthService, CategoriesService, ShopsService, ProductsService, OrdersService, LetoService, SettingsService, StorageService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
