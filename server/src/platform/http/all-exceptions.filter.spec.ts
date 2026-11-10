import { QueryFailedError } from 'typeorm';
import { constraintError } from './all-exceptions.filter';

const failure = (code: string): QueryFailedError =>
  new QueryFailedError('INSERT ...', [], Object.assign(new Error(code), { code }));

describe('constraintError', () => {
  it('maps unique / primary-key violations to 409', () => {
    expect(constraintError(failure('SQLITE_CONSTRAINT_UNIQUE'))?.status).toBe(409);
    expect(constraintError(failure('SQLITE_CONSTRAINT_PRIMARYKEY'))?.status).toBe(409);
  });

  it('maps foreign-key violations to 400', () => {
    expect(constraintError(failure('SQLITE_CONSTRAINT_FOREIGNKEY'))?.status).toBe(400);
  });

  it('leaves other errors to the generic 500', () => {
    expect(constraintError(failure('SQLITE_BUSY'))).toBeNull();
    expect(constraintError(new Error('boom'))).toBeNull();
  });
});
