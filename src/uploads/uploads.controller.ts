import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { memoryStorage } from 'multer';
import { Public } from '../common/decorators';
import { StorageService } from '../storage/storage.service';

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
const NAME = /^[0-9a-f-]{36}\.(jpg|png|webp|heic)$/;
const upload = () =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, !!EXT[file.mimetype] || file.mimetype === 'image/jpg'),
  });
const MISSING = 'Image manquante ou format non accepté (jpg, png, webp, heic, 5 Mo max)';

/** Lien signé et temporaire (15 min) vers une pièce d'identité */
export function identityLink(path: string | null | undefined) {
  if (!path) return null;
  const name = path.replace(/^\/identity\//, '');
  const exp = Math.floor(Date.now() / 1000) + 15 * 60;
  return `/files/identity/${name}?exp=${exp}&sig=${sign(name, exp)}`;
}
const sign = (name: string, exp: number) => createHmac('sha256', process.env.JWT_SECRET ?? 'adjame').update(`identity:${name}:${exp}`).digest('hex').slice(0, 32);

/**
 * Photos : produits, boutiques, profils (publiques, noms impossibles à deviner) et pièces d'identité
 * (stockées à part, lisibles seulement par un lien signé et temporaire donné à l'équipe).
 */
@Controller()
export class UploadsController {
  constructor(private storage: StorageService) {}

  @Post('uploads')
  @UseInterceptors(upload())
  async photo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException(MISSING);
    const name = `${randomUUID()}${EXT[file.mimetype] ?? '.jpg'}`;
    await this.storage.save(name, file.buffer, file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype);
    return { url: `/uploads/${name}` };
  }

  @Post('uploads/identity')
  @UseInterceptors(upload())
  async identity(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException(MISSING);
    const name = `${randomUUID()}${EXT[file.mimetype] ?? '.jpg'}`;
    await this.storage.save(name, file.buffer, file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype, 'identity');
    return { url: `/identity/${name}` };
  }

  @Public()
  @Get('uploads/:name')
  async read(@Param('name') name: string, @Res() res: Response) {
    if (!NAME.test(name)) throw new NotFoundException();
    const path = this.storage.localPath(name);
    if (existsSync(path)) return res.sendFile(path);
    if (!this.storage.usesWasabi) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, max-age=3000');
    return res.redirect(302, await this.storage.signedUrl(name, 'photos', 3600));
  }

  @Public()
  @Get('files/identity/:name')
  async readIdentity(@Param('name') name: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const e = Number(exp);
    if (!NAME.test(name) || !Number.isInteger(e) || e < Date.now() / 1000 || typeof sig !== 'string') throw new NotFoundException();
    const a = Buffer.from(sign(name, e));
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    const path = this.storage.localPath(name, 'identity');
    if (existsSync(path)) return res.sendFile(path);
    if (!this.storage.usesWasabi) throw new NotFoundException();
    return res.redirect(302, await this.storage.signedUrl(name, 'identity', 300));
  }
}
