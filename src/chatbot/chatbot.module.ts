import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { ChatbotController } from './chatbot.controller';
import { AiIntentService } from './ai-intent.service';
import { ChatbotService } from './chatbot.service';

@Module({
  imports: [ProductsModule, PrismaModule, AuthModule],
  controllers: [ChatbotController],
  providers: [ChatbotService, AiIntentService],
})
export class ChatbotModule {}
