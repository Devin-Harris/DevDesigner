import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReorderElementsDto } from '../elements/dto/reorder-elements.dto';
import { UpdateElementPositionDto } from '../elements/dto/update-element-position.dto';
import { UpdateRelationshipDto } from '../relationships/dto/update-relationship.dto';
import { CreateIndexDto } from '../indexes/dto/create-index.dto';
import { DataTypeDto } from '../columns/dto/data-type.dto';
import {
  MAX_ELEMENT_POINTS,
  MAX_ID_LENGTH,
  MAX_INDEX_COLUMNS,
  MAX_REORDER_ELEMENTS,
  MAX_TYPE_ARGS,
  MAX_WAYPOINTS,
} from './limits';

/** Array caps on request DTOs (security M-5): at the cap passes, one over fails. */
describe('request array caps', () => {
  async function errors<T extends object>(cls: new () => T, body: object): Promise<string[]> {
    const found = await validate(plainToInstance(cls, body), { whitelist: true });
    return found.map((e) => e.property);
  }
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));

  it('caps reorder ids and their length', async () => {
    expect(
      await errors(ReorderElementsDto, { orderedElementIds: ids(MAX_REORDER_ELEMENTS) }),
    ).toEqual([]);
    expect(
      await errors(ReorderElementsDto, { orderedElementIds: ids(MAX_REORDER_ELEMENTS + 1) }),
    ).toEqual(['orderedElementIds']);
    expect(
      await errors(ReorderElementsDto, { orderedElementIds: ['x'.repeat(MAX_ID_LENGTH + 1)] }),
    ).toEqual(['orderedElementIds']);
  });

  it('caps element points and relationship waypoints', async () => {
    expect(await errors(UpdateElementPositionDto, { points: points(MAX_ELEMENT_POINTS) })).toEqual(
      [],
    );
    expect(
      await errors(UpdateElementPositionDto, { points: points(MAX_ELEMENT_POINTS + 1) }),
    ).toEqual(['points']);
    expect(await errors(UpdateRelationshipDto, { waypoints: points(MAX_WAYPOINTS + 1) })).toEqual([
      'waypoints',
    ]);
  });

  it('caps index columns and data-type args', async () => {
    expect(
      await errors(CreateIndexDto, { name: 'ix', columnIds: ids(MAX_INDEX_COLUMNS + 1) }),
    ).toEqual(['columnIds']);
    expect(
      await errors(DataTypeDto, { name: 'ENUM', args: Array(MAX_TYPE_ARGS + 1).fill('a') }),
    ).toEqual(['args']);
    expect(await errors(DataTypeDto, { name: 'ENUM', args: ['a', 'b'] })).toEqual([]);
  });
});
