import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { User } from '../identity/auth/user.entity';
import { parseAdminEmails } from '../platform/config/env.validation';

/**
 * Promotes users whose email is in ADMIN_EMAILS: every existing match on boot, and a
 * matching user on register/login. Promotion only; `users.role` is authoritative, so
 * removing an email from the env never demotes (demote with an explicit SQL update).
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);
  private readonly allowlist: ReadonlySet<string>;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    config: ConfigService,
  ) {
    this.allowlist = new Set(parseAdminEmails(config.get<string>('ADMIN_EMAILS')));
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.allowlist.size === 0) {
      return;
    }
    const pending = await this.users.find({
      where: { email: In([...this.allowlist]), role: Not('admin') },
      select: { id: true, email: true },
    });
    if (pending.length === 0) {
      return;
    }
    await this.users.update({ id: In(pending.map((user) => user.id)) }, { role: 'admin' });
    this.logger.log(`Promoted ${pending.length} allowlisted user(s) to admin: ${pending.map((u) => u.email).join(', ')}`);
  }

  isAllowlisted(email: string | null): boolean {
    return email !== null && this.allowlist.has(email.trim().toLowerCase());
  }

  /** Promote `user` in place (and in the DB) when allowlisted and not already admin. */
  async promoteIfAllowlisted(user: User): Promise<void> {
    if (user.role === 'admin' || !this.isAllowlisted(user.email)) {
      return;
    }
    await this.users.update({ id: user.id }, { role: 'admin' });
    user.role = 'admin';
    this.logger.log(`Promoted allowlisted user ${user.email} to admin`);
  }
}
