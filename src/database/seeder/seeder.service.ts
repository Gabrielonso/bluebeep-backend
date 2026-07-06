// src/seeder/seeder.service.ts
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { User } from 'src/modules/user/entity/user.entity';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { UserRoles } from 'src/common/enums/user-roles.constants';

@Injectable()
export class SeederService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {}

  private get superAdminUser() {
    return {
      email: this.configService.get('ADMIN_EMAIL'),
      password: this.configService.get('ADMIN_PASSWORD'),
    };
  }

  async onApplicationBootstrap() {
    try {
      await this.seed();
    } catch (error) {
      console.error(
        'Seeding failed. Application will not start:',
        error.message,
      );
      process.exit(1);
    }
  }

  async superAdminSeed(entityManager) {
    try {
      const userRepo = entityManager.getRepository(User);

      const superAdminExists = await userRepo.findOne({
        where: { role: UserRoles.SUPER_ADMIN },
      });

      if (!superAdminExists) {
        const { email, password } = this.superAdminUser;
        if (!email || !password) {
          throw new Error('No credentials set for super admin');
        }

        const hashedPassword = await hash(password, 10);
        const createAdminUser = await userRepo.create({
          firstName: 'Admin',
          lastName: 'Bluebeep',
          email,
          password: hashedPassword,
          role: UserRoles.SUPER_ADMIN,
          verified: true,
          username: 'admin',
        });
        await userRepo.save(createAdminUser);
      }
    } catch (error) {
      throw error;
    }
  }

  async seed() {
    try {
      await this.dataSource.manager.transaction(async (entityManager) => {
        await this.superAdminSeed(entityManager);
      });
    } catch (error) {
      throw error;
    }
  }
}
