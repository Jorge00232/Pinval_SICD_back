import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ChatbotService } from './chatbot.service';

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Get()
  getStatus() {
    return this.chatbotService.getStatus();
  }

  @Post('message')
  @Roles('ADMIN', 'STOCK', 'VIEWER')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async answerMessage(
    @Body() body: { message?: unknown },
    @Req() request: Request,
  ) {
    const user = (request as Request & { user: AuthenticatedUser }).user;
    const response = await this.chatbotService.answerMessage(body.message);

    await this.chatbotService.recordAudit(body.message, user, response.type);

    return response;
  }
}
