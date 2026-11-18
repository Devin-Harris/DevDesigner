import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { requestContext } from './request-context';

/**
 * SQLite constraint failures that reach the filter are the caller's fault (a row that
 * already exists, a reference to a row that does not), not a server error: 409 / 400
 * with a generic message (the driver's text names tables and columns).
 */
export function constraintError(exception: unknown): { status: number; message: string } | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const code = (exception.driverError as { code?: unknown } | undefined)?.code;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return { status: HttpStatus.CONFLICT, message: 'That item already exists.' };
  }
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return {
      status: HttpStatus.BAD_REQUEST,
      message: 'That refers to an item that does not exist.',
    };
  }
  return null;
}

/** body-parser (http-errors) client errors, e.g. 413 too large or 415 gzip refused. */
function clientHttpError(exception: unknown): { status: number; message: string } | null {
  if (!(exception instanceof Error)) return null;
  const { status, expose } = exception as Error & { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true
    ? { status, message: exception.message }
    : null;
}

/**
 * Global filter (APP_FILTER). HttpExceptions keep Nest's exact default JSON body
 * (the client reads `error.message`); SQLite constraint
 * failures become 409/400 and anything else a generic 500 carrying
 * the request id, with the stack only in the logs. 5xx are logged and sent to Sentry
 * (a no-op unless SENTRY_DSN is set).
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  override catch(exception: unknown, host: ArgumentsHost): void {
    const clientError = clientHttpError(exception) ?? constraintError(exception);
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (clientError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const requestId = requestContext()?.requestId;

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error({ err, requestId, status }, err.message);
      Sentry.captureException(exception, (scope) => {
        if (requestId) scope.setTag('request_id', requestId);
        return scope;
      });
    }

    if (host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }
    if (exception instanceof HttpException) {
      // Same body as Nest's default handler; its own logging is skipped for HttpExceptions.
      super.catch(exception, host);
      return;
    }

    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json({
      statusCode: status,
      message: clientError?.message ?? 'Internal server error',
      ...(requestId ? { requestId } : {}),
    });
  }
}
