import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountActivityModule } from '../account-activity/account-activity.module';
import { User } from '../user/entity/user.entity';
import { AbuseReportNote } from './entities/abuse-report-note.entity';
import { AbuseReport } from './entities/abuse-report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AbuseReport, AbuseReportNote, User]),
    AccountActivityModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [TypeOrmModule, ReportsService],
})
export class ReportsModule {}
