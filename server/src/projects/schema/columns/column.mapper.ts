import { isUnsignedType, parseDataType, type ColumnModel, type DataType } from '@devdesigner/shared';
import { ColumnEntity } from './column.entity';

/** Map a Column entity to the shared ColumnModel consumed by client + SQL/validation. */
export function toColumnModel(entity: ColumnEntity): ColumnModel {
  // Older rows (MCP / SQL import) stored the modifier in the name ("INT UNSIGNED").
  const legacyUnsigned = isUnsignedType(entity.dataTypeName);
  const dataType: DataType = {
    name: legacyUnsigned ? parseDataType(entity.dataTypeName).name : entity.dataTypeName,
    length: entity.dataTypeLength ?? undefined,
    args: entity.dataTypeArgs ? (JSON.parse(entity.dataTypeArgs) as string[]) : undefined,
  };
  return {
    id: entity.id,
    name: entity.name,
    dataType,
    isPrimaryKey: entity.isPrimaryKey,
    isNullable: entity.isNullable,
    isUnique: entity.isUnique,
    isAutoIncrement: entity.isAutoIncrement,
    ...(entity.isUnsigned || legacyUnsigned ? { isUnsigned: true } : {}),
    defaultValue: entity.defaultValue ?? undefined,
    note: entity.note ?? undefined,
  };
}

/** Split a shared DataType into the entity's stored columns. */
export function fromDataType(dataType: DataType): {
  dataTypeName: string;
  dataTypeLength: number | null;
  dataTypeArgs: string | null;
} {
  return {
    dataTypeName: dataType.name,
    dataTypeLength: dataType.length ?? null,
    dataTypeArgs: dataType.args && dataType.args.length ? JSON.stringify(dataType.args) : null,
  };
}
