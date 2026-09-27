import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { ElementsService } from './elements.service';
import type { ElementEntity } from './element.entity';
import type { Project } from '../projects/project.entity';
import type { AccessService } from '../access/access.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import type { CreateElementDto } from './dto/create-element.dto';

/**
 * Unit tests for the canvas-elements service: authorization is enforced before a
 * write, the persisted change is broadcast to the realtime room, and geometry
 * round-trips through the mapper. Repositories and collaborators are mocked so no
 * database or socket is involved.
 */
describe('ElementsService', () => {
  let elements: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let projects: { findOne: jest.Mock };
  let access: {
    assertCanWrite: jest.Mock;
    assertCanWriteElement: jest.Mock;
  };
  let realtime: { emit: jest.Mock };
  let service: ElementsService;

  const baseDto: CreateElementDto = {
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    strokeColor: '#000000',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
  };

  beforeEach(() => {
    elements = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'el1', ...v })),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(async () => ({ affected: 1 })),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    projects = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }) };
    access = {
      assertCanWrite: jest.fn().mockResolvedValue('OWNER'),
      assertCanWriteElement: jest.fn().mockResolvedValue('p1'),
    };
    realtime = { emit: jest.fn() };
    service = new ElementsService(
      elements as unknown as Repository<ElementEntity>,
      projects as unknown as Repository<Project>,
      access as unknown as AccessService,
      realtime as unknown as RealtimePublisher,
    );
  });

  it('authorizes, persists, and broadcasts on create', async () => {
    elements.findOne.mockResolvedValue(null); // no existing element -> zIndex 0
    const model = await service.create('p1', baseDto, 'u1', null, 'client-1');
    expect(access.assertCanWrite).toHaveBeenCalledWith('p1', 'u1', null);
    expect(model.id).toBe('el1');
    expect(model.type).toBe('rectangle');
    expect(model.zIndex).toBe(0);
    expect(realtime.emit).toHaveBeenCalledWith('p1', 'client-1', {
      kind: 'element.created',
      element: model,
    });
  });

  it('round-trips freehand points through pointsJson', async () => {
    elements.findOne.mockResolvedValue(null);
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 9 },
    ];
    const model = await service.create('p1', { ...baseDto, type: 'freedraw', points }, 'u1');
    expect(elements.create).toHaveBeenCalledWith(
      expect.objectContaining({ pointsJson: JSON.stringify(points) }),
    );
    expect(model.points).toEqual(points);
  });

  it('broadcasts element.moved on a position update', async () => {
    await service.updatePosition('el1', { x: 42, y: 7 }, 'u1', null, 'client-1');
    expect(access.assertCanWriteElement).toHaveBeenCalledWith('el1', 'u1', null);
    expect(elements.update).toHaveBeenCalledWith({ id: 'el1' }, { x: 42, y: 7 });
    expect(realtime.emit).toHaveBeenCalledWith('p1', 'client-1', {
      kind: 'element.moved',
      elementId: 'el1',
      x: 42,
      y: 7,
      points: undefined,
    });
  });

  it('broadcasts element.deleted on remove', async () => {
    await service.remove('el1', 'u1', null, 'client-1');
    expect(elements.delete).toHaveBeenCalledWith({ id: 'el1' });
    expect(realtime.emit).toHaveBeenCalledWith('p1', 'client-1', {
      kind: 'element.deleted',
      elementId: 'el1',
    });
  });

  it('does not persist or broadcast when authorization fails', async () => {
    access.assertCanWrite.mockRejectedValue(new ForbiddenException('This link is read-only.'));
    await expect(service.create('p1', baseDto, null, 'view-token')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(elements.save).not.toHaveBeenCalled();
    expect(realtime.emit).not.toHaveBeenCalled();
  });
});
