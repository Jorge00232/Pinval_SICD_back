import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

type LoginBody = {
  username?: string;
  password?: string;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: LoginBody) {
    return this.authService.login(body);
  }
}
