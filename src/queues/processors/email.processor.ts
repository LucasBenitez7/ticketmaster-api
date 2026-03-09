import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EMAIL_QUEUE } from '../queues.constants';
import { EmailJobData, JOB_SEND_EMAIL } from '../queues.service';

@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  process(job: Job<EmailJobData>): Promise<void> {
    if (job.name !== JOB_SEND_EMAIL) return Promise.resolve();

    const { to, subject, orderId, eventTitle, userName } = job.data;

    this.logger.log(
      `📧 [EMAIL] Purchase confirmed | To: ${to} (${userName}) | Order: ${orderId} | Event: ${eventTitle} | Subject: ${subject}`,
    );

    return Promise.resolve();
  }
}
