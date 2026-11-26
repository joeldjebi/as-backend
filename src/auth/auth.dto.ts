import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsPhone, PHONE_MESSAGE } from '../countries/phone';

export class RegisterDto {
  @IsString() @IsNotEmpty({ message: 'Nom obligatoire' }) @MaxLength(100) name: string;
  @IsPhone({ message: PHONE_MESSAGE }) phone: string;
  @IsString() @MinLength(6, { message: 'Mot de passe : 6 caractères minimum' }) password: string;
}

export class LoginDto {
  @IsPhone({ message: PHONE_MESSAGE, anyCountry: true }) phone: string;
  @IsString() @IsNotEmpty({ message: 'Mot de passe obligatoire' }) password: string;
}

export class ProfileDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @Matches(/^\/uploads\/[\w.-]+$/) avatarUrl?: string;
  @IsOptional() @IsString() currentPassword?: string;
  @IsOptional() @IsString() @MinLength(6, { message: 'Nouveau mot de passe : 6 caractères minimum' }) newPassword?: string;
}

export class AddressDto {
  @IsString() @IsNotEmpty({ message: 'Nom de l’adresse obligatoire (ex. Maison)' }) @MaxLength(40) label: string;
  @IsString() @IsNotEmpty({ message: 'Adresse obligatoire' }) @MaxLength(200) address: string;
  @IsOptional() @IsString() @MaxLength(200) landmark?: string;
  @Type(() => Number) @IsLatitude() lat: number;
  @Type(() => Number) @IsLongitude() lng: number;
}

export class ResellerDto {
  @IsString() @IsNotEmpty({ message: 'Nom du commerce obligatoire' }) @MaxLength(100) businessName: string;
  @IsOptional() @IsString() @MaxLength(40) commune?: string;
  @Matches(/^\/identity\/[\w.-]+$/, { message: 'Photo de la pièce d’identité obligatoire' }) idPhotoUrl: string;
  @Matches(/^\/uploads\/[\w.-]+$/, { message: 'Photo du commerce obligatoire' }) shopPhotoUrl: string;
}
