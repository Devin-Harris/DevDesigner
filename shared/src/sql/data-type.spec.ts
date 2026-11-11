import { formatDataType, isUnsignedType, parseDataType } from './data-type';

describe('parseDataType', () => {
  it('parses lengths, precision and enum values', () => {
    expect(parseDataType('varchar(100)')).toEqual({ name: 'VARCHAR', length: 100 });
    expect(parseDataType('VARCHAR')).toEqual({ name: 'VARCHAR', length: 255 });
    expect(parseDataType('DECIMAL(10, 2)')).toEqual({ name: 'DECIMAL', args: ['10', '2'] });
    expect(parseDataType("ENUM('a','b')")).toEqual({ name: 'ENUM', args: ['a', 'b'] });
    expect(parseDataType('int')).toEqual({ name: 'INT' });
    expect(parseDataType(undefined)).toEqual({ name: 'VARCHAR', length: 255 });
  });

  it('drops the UNSIGNED modifier (it is a column flag)', () => {
    expect(parseDataType('INT UNSIGNED')).toEqual({ name: 'INT' });
    expect(parseDataType('bigint(20) unsigned')).toEqual({ name: 'BIGINT', args: ['20'] });
    expect(isUnsignedType('INT UNSIGNED')).toBe(true);
    expect(isUnsignedType('INT')).toBe(false);
  });
});

describe('formatDataType', () => {
  it('round-trips lengths and args', () => {
    expect(formatDataType({ name: 'VARCHAR', length: 64 })).toBe('VARCHAR(64)');
    expect(formatDataType({ name: 'DECIMAL', args: ['10', '2'] })).toBe('DECIMAL(10,2)');
    expect(formatDataType({ name: 'INT' })).toBe('INT');
    expect(parseDataType(formatDataType({ name: 'DECIMAL', args: ['10', '2'] }))).toEqual({ name: 'DECIMAL', args: ['10', '2'] });
  });
});
