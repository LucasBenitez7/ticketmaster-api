import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EMAIL_QUEUE } from '../queues.constants';
import { JOB_SEND_EMAIL } from '../queues.service';
import { EmailService } from '../../email/email.service';
import { EmailPayload } from '../../email/email.types';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async process(job: Job<EmailPayload>): Promise<void> {
    if (job.name !== JOB_SEND_EMAIL) return;

    this.logger.debug(
      `Processing email job [${job.data.type}] → ${job.data.to}`,
    );

    try {
      await this.emailService.send(job.data);
    } catch (err) {
      this.logger.error(
        `❌ Email job failed [${job.data.type}] → ${job.data.to}`,
        err,
      );
      throw err;
    }
  }
}
