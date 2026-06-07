import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

type LoginBody = {
  username?: string;
  password?: string;
};

type GoogleLoginBody = {
  idToken?: string;
};

type TwoFactorSetupBody = {
  challengeId?: string;
};

type TwoFactorVerifyBody = {
  challengeId?: string;
  token?: string;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: LoginBody) {
    return this.authService.login(body);
  }

  @Post('google')
  googleLogin(@Body() body: GoogleLoginBody) {
    return this.authService.googleLogin(body);
  }

  @Post('2fa/setup')
  setupTwoFactor(@Body() body: TwoFactorSetupBody) {
    return this.authService.setupTwoFactor(body);
  }

  @Post('2fa/verify')
  verifyTwoFactor(@Body() body: TwoFactorVerifyBody) {
    return this.authService.verifyTwoFactor(body);
  }
}