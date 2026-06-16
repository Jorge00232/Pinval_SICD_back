import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ImportsService } from './imports.service';
import type { UploadedExcelFile } from './imports.service';

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
  importProducts(@UploadedFile() file?: UploadedExcelFile) {
    this.validateFile(file);
    return this.importsService.importProducts(file);
  }

  @Post('customers/excel')
  @UseInterceptors(excelFileInterceptor)
  importCustomers(@UploadedFile() file?: UploadedExcelFile) {
    this.validateFile(file);
    return this.importsService.importCustomers(file);
  }

  @Post('suppliers/excel')
  @UseInterceptors(excelFileInterceptor)
  importSuppliers(@UploadedFile() file?: UploadedExcelFile) {
    this.validateFile(file);
    return this.importsService.importSuppliers(file);
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
      throw new BadRequestException('El archivo Excel esta vacio.');
    }
  }
}
