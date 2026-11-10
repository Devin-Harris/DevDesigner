import {
  ANALYTICS_ELEMENT_TYPES,
  ANALYTICS_EVENTS,
  isClientAnalyticsEventName,
  MUTATION_KINDS,
  sanitizeAnalyticsProps,
  type AnalyticsEventSpec,
} from './events';
import { ELEMENT_TYPES } from '../enums';

describe('analytics event catalog', () => {
  it('declares no free-text props: only numbers, booleans and fixed enums', () => {
    for (const [name, spec] of Object.entries(ANALYTICS_EVENTS) as Array<[string, AnalyticsEventSpec]>) {
      for (const [key, prop] of Object.entries(spec.props)) {
        expect([name, key, ['number', 'boolean', 'enum'].includes(prop.type)]).toEqual([name, key, true]);
        if (prop.type === 'enum') {
          expect(prop.values.length).toBeGreaterThan(0);
          for (const v of prop.values) expect(v.length).toBeLessThanOrEqual(48);
        }
      }
    }
  });

  it('keeps element types in sync with the shared enum', () => {
    expect([...ANALYTICS_ELEMENT_TYPES].sort()).toEqual([...ELEMENT_TYPES].sort());
  });

  it('lists each mutation kind once', () => {
    expect(new Set(MUTATION_KINDS).size).toBe(MUTATION_KINDS.length);
  });

  it('only lets the client send client.* events', () => {
    expect(isClientAnalyticsEventName('client.pageview')).toBe(true);
    expect(isClientAnalyticsEventName('auth.signup')).toBe(false);
    expect(isClientAnalyticsEventName('nope')).toBe(false);
    expect(isClientAnalyticsEventName('__proto__')).toBe(false);
  });

  it('drops unknown keys and invalid values', () => {
    expect(sanitizeAnalyticsProps('nope', {})).toBeNull();
    expect(
      sanitizeAnalyticsProps('client.export_image', {
        format: 'png',
        scope: 'my secret table',
        text: 'CREATE TABLE users',
        extra: 1,
      }),
    ).toEqual({ format: 'png' });
    expect(sanitizeAnalyticsProps('client.present', { slides: -1, durationMs: Infinity, solo: 'yes' })).toEqual({});
    expect(sanitizeAnalyticsProps('client.present', { slides: 12, durationMs: 1500.12345, solo: true })).toEqual({
      slides: 12,
      durationMs: 1500.123,
      solo: true,
    });
    expect(sanitizeAnalyticsProps('project.deleted', 'string')).toEqual({});
  });
});
