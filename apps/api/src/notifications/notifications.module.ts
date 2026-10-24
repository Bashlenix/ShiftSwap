import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AppOriginRegistry } from './app-origin';
import { MailDispatchInterceptor } from './mail-dispatch.interceptor';
import { NotificationMailScheduler } from './notification-mail.scheduler';
import { NotificationMailer } from './notification-mailer';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [TenancyModule, MailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationMailer,
    AppOriginRegistry,
    MailDispatchInterceptor,
    NotificationMailScheduler,
  ],
  exports: [NotificationsService, NotificationMailer, AppOriginRegistry, MailDispatchInterceptor],
})
export class NotificationsModule {}
