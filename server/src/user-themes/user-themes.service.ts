import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SlideTheme, UserThemeResponse } from '@devdesigner/shared';
import { UserThemeEntity } from './user-theme.entity';
import { SaveUserThemeDto } from './dto/save-user-theme.dto';

/** Most themes one library keeps. */
const MAX_USER_THEMES = 100;

@Injectable()
export class UserThemesService {
  constructor(@InjectRepository(UserThemeEntity) private readonly themes: Repository<UserThemeEntity>) {}

  async list(ownerId: string | null): Promise<UserThemeResponse[]> {
    const owner = this.require(ownerId);
    const rows = await this.themes.find({ where: { ownerId: owner }, order: { createdAt: 'ASC' } });
    return rows.map(toResponse);
  }

  /** Save a theme; one with the same theme id replaces the saved copy. */
  async save(ownerId: string | null, dto: SaveUserThemeDto): Promise<UserThemeResponse> {
    const owner = this.require(ownerId);
    const rows = await this.themes.find({ where: { ownerId: owner } });
    const same = dto.theme.id ? rows.find((r) => parse(r.themeJson).id === dto.theme.id) : undefined;
    if (!same && rows.length >= MAX_USER_THEMES) {
      throw new BadRequestException(`A library holds at most ${MAX_USER_THEMES} themes.`);
    }
    const row = same ?? this.themes.create({ ownerId: owner });
    row.themeJson = JSON.stringify(dto.theme);
    return toResponse(await this.themes.save(row));
  }

  async remove(ownerId: string | null, id: string): Promise<void> {
    const owner = this.require(ownerId);
    const result = await this.themes.delete({ id, ownerId: owner });
    if (!result.affected) throw new NotFoundException('Theme not found.');
  }

  private require(ownerId: string | null): string {
    if (!ownerId) throw new UnauthorizedException('Sign in to keep themes in a library.');
    return ownerId;
  }
}

function parse(json: string): SlideTheme {
  return JSON.parse(json) as SlideTheme;
}

function toResponse(row: UserThemeEntity): UserThemeResponse {
  return { id: row.id, theme: parse(row.themeJson), createdAt: row.createdAt.toISOString() };
}
