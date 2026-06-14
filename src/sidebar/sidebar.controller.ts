import { Controller, Get } from '@nestjs/common';
import { SidebarService } from './sidebar.service';

@Controller('sidebar')
export class SidebarController {
  constructor(private readonly sidebarService: SidebarService) {}

  @Get('summary')
  getSummary() {
    return this.sidebarService.getSummary();
  }
}