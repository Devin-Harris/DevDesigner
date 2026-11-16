import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandler, Injector } from '@angular/core';
import { classifyError } from './error-kind.helper';
import { TelemetryErrorHandler } from './error-telemetry';
import { TelemetryService } from './telemetry.service';

describe('classifyError', () => {
   it.each<[unknown, string]>([
      [new HttpErrorResponse({ status: 500 }), 'http'],
      [new TypeError('Failed to fetch dynamically imported module: /chunk-X.js'), 'chunk_load'],
      [new Error('boom'), 'uncaught'],
      ['plain', 'uncaught'],
   ])('%s -> %s', (error, kind) => {
      expect(classifyError(error)).toBe(kind);
   });

   it('keeps the fallback for unknown rejections', () => {
      expect(classifyError(new Error('nope'), 'unhandled_rejection')).toBe('unhandled_rejection');
   });
});

describe('TelemetryErrorHandler', () => {
   it('counts the error, then passes it on unchanged', () => {
      const track = jest.fn();
      const inner = { handleError: jest.fn() } as unknown as ErrorHandler;
      const injector = Injector.create({ providers: [{ provide: TelemetryService, useValue: { track } }] });
      const error = new Error('x');
      new TelemetryErrorHandler(injector, inner).handleError(error);
      expect(track).toHaveBeenCalledWith('client.error', { kind: 'uncaught' });
      expect(inner.handleError).toHaveBeenCalledWith(error);
   });

   it('still reports the error when telemetry is unavailable', () => {
      const inner = { handleError: jest.fn() } as unknown as ErrorHandler;
      new TelemetryErrorHandler(Injector.create({ providers: [] }), inner).handleError('e');
      expect(inner.handleError).toHaveBeenCalledWith('e');
   });
});
