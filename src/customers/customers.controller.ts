import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CustomersService } from './customers.service';

export type CreateCustomerBody = {
  name?: string;
  contact?: string | null;
  identifier?: string | null;
  customerType?: 'B2B' | 'B2C';
};

export type UpdateCustomerBody = Partial<CreateCustomerBody> & {
  isActive?: boolean;
};

type AuthRequest = Request & { user?: AuthenticatedUser };

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Roles('ADMIN', 'STOCK', 'VIEWER')
  findAll(@Req() request: AuthRequest) {
    return this.customersService.findAll(request.user?.role);
  }

  @Post()
  @Roles('ADMIN', 'STOCK')
  create(@Body() body: CreateCustomerBody, @Req() request: AuthRequest) {
    return this.customersService.create(body, request.user);
  }

  @Patch(':id')
  @Roles('ADMIN', 'STOCK')
  update(
    @Param('id') id: string,
    @Body() body: UpdateCustomerBody,
    @Req() request: AuthRequest,
  ) {
    return this.customersService.update(id, body, request.user);
  }
}
