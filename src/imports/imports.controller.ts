import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ImportsService } from './imports.service';
import type { AuditActor, UploadedExcelFile } from './imports.service';

type AuthRequest = Request & { user?: AuditActor };

const excelFileInterceptor = FileInterceptor('file', {
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STOCK')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('products/excel')
  @UseInterceptors(excelFileInterceptor)
  importProducts(
    @UploadedFile() file: UploadedExcelFile | undefined,
    @Req() request: AuthRequest,
  ) {
    this.validateFile(file);
    return this.importsService.importProducts(file, request.user);
  }

  @Post('customers/excel')
  @UseInterceptors(excelFileInterceptor)
  importCustomers(
    @UploadedFile() file: UploadedExcelFile | undefined,
    @Req() request: AuthRequest,
  ) {
    this.validateFile(file);
    return this.importsService.importCustomers(file, request.user);
  }

  @Post('suppliers/excel')
  @UseInterceptors(excelFileInterceptor)
  importSuppliers(
    @UploadedFile() file: UploadedExcelFile | undefined,
    @Req() request: AuthRequest,
  ) {
    this.validateFile(file);
    return this.importsService.importSuppliers(file, request.user);
  }

  private validateFile(file?: UploadedExcelFile): asserts file is UploadedExcelFile {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo Excel.');
    }

    const fileName = file.originalname.toLowerCase();
    const isExcelFile = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    if (!isExcelFile) {
      throw new BadRequestException('El archivo debe tener formato .xlsx o .xls.');
    }

    if (!file.buffer?.length) {
      throw new BadRequestException('El archivo Excel está vacío.');
    }
  }
}
