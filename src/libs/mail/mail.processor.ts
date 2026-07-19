import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ZeptoMail } from 'src/common/zepto-mail';
import { JobQueue, JobType } from 'src/common/enums/jobs.enum';

@Processor(JobQueue.EMAILS)
export class EmailProcessor extends WorkerHost {
  private readonly zeptoMailService = new ZeptoMail();

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JobType.SEND_EMAIL_ZEPTO: {
        const { recipient, subject, templateId, templateVariables } = job.data;
        await this.zeptoMailService.sendMailWithZepto({
          recipient,
          subject,
          template_id: templateId,
          template_variables: templateVariables,
          reply_to_email: '',
          allow_to_reply: false,
          send_attachment: false,
        });
        break;
      }
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(
      `Email job failed: ${job.id} (attempt ${job.attemptsMade}) with error:`,
      error?.message ?? error,
    );
  }
}
