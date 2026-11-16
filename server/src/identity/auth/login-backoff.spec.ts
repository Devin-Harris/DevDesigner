import { LoginBackoff } from './login-backoff';

describe('LoginBackoff', () => {
  let now = 1_000_000;
  const clock = (): number => now;

  beforeEach(() => {
    now = 1_000_000;
  });

  it('allows the first five failures, then locks with a doubling delay', () => {
    const b = new LoginBackoff(clock);
    for (let i = 0; i < 5; i++) b.recordFailure('a@x.test');
    expect(b.retryAfterMs('a@x.test')).toBe(0);
    b.recordFailure('a@x.test');
    expect(b.retryAfterMs('a@x.test')).toBe(30_000);
    now += 30_000;
    expect(b.retryAfterMs('a@x.test')).toBe(0);
    b.recordFailure('a@x.test');
    expect(b.retryAfterMs('a@x.test')).toBe(60_000);
  });

  it('caps the delay at 15 minutes', () => {
    const b = new LoginBackoff(clock);
    for (let i = 0; i < 30; i++) b.recordFailure('a@x.test');
    expect(b.retryAfterMs('a@x.test')).toBe(15 * 60_000);
  });

  it('is per email and cleared by a success', () => {
    const b = new LoginBackoff(clock);
    for (let i = 0; i < 6; i++) b.recordFailure('a@x.test');
    expect(b.retryAfterMs('b@x.test')).toBe(0);
    b.recordSuccess('a@x.test');
    expect(b.retryAfterMs('a@x.test')).toBe(0);
  });

  it('forgets failures after an hour', () => {
    const b = new LoginBackoff(clock);
    for (let i = 0; i < 6; i++) b.recordFailure('a@x.test');
    now += 61 * 60_000;
    expect(b.retryAfterMs('a@x.test')).toBe(0);
    b.recordFailure('a@x.test');
    expect(b.retryAfterMs('a@x.test')).toBe(0);
  });
});
