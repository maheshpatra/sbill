import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.name.replace(/Exception$/, '') || error;
      } else if (body && typeof body === 'object') {
        const record = body as { message?: string | string[]; error?: string };
        message = record.message ?? exception.message;
        error = record.error ?? error;
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    const extras: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        for (const key of ['code', 'feature', 'required_plan']) {
          if (record[key] !== undefined) extras[key] = record[key];
        }
      }
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
      ...extras,
    });
  }
}
