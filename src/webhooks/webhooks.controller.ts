import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('stripe')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  handleStripe(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    return this.webhooksService.handleStripeWebhook(
      req.body as Buffer,
      signature,
    );
  }
}
