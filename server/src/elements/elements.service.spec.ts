import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { ElementsService } from './elements.service';
import type { ElementEntity } from './element.entity';
import type { Project } from '../projects/project.entity';
import type { AccessService } from '../access/access.service';
import type { ImagesService } from '../images/images.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';
import type { CreateElementDto } from './dto/create-element.dto';

/**
 * Unit tests for the canvas-elements service: the persisted change is broadcast to
 * the realtime room and geometry round-trips through the mapper. Authorization
 * happens in the route guard (see access/project-access.guard.spec.ts). Repositories and collaborators are mocked so no
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
    manager: { transaction: jest.Mock };
  };
  let tx: { find: jest.Mock; update: jest.Mock };
  let projects: { findOne: jest.Mock };
  let access: {
    assertCanWrite: jest.Mock;
    assertCanWriteElement: jest.Mock;
  };
  let realtime: { emit: jest.Mock };
  let images: { existsInProject: jest.Mock };
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
      manager: { transaction: jest.fn(async (work: (m: typeof tx) => unknown) => work(tx)) },
    };
    tx = { find: jest.fn().mockResolvedValue([]), update: jest.fn(async () => ({ affected: 1 })) };
    projects = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }) };
    access = {
      assertCanWrite: jest.fn().mockResolvedValue('OWNER'),
      assertCanWriteElement: jest.fn().mockResolvedValue('p1'),
    };
    realtime = { emit: jest.fn() };
    images = { existsInProject: jest.fn().mockResolvedValue(true) };
    service = new ElementsService(
      elements as unknown as Repository<ElementEntity>,
      projects as unknown as Repository<Project>,
      access as unknown as AccessService,
      realtime as unknown as RealtimePublisher,
      images as unknown as ImagesService,
    );
  });

  it('persists and broadcasts on create', async () => {
    elements.findOne.mockResolvedValue(null); // no existing element -> zIndex 0
    const model = await service.create('p1', baseDto);
    expect(model.id).toBe('el1');
    expect(model.type).toBe('rectangle');
    expect(model.zIndex).toBe(0);
    expect(realtime.emit).toHaveBeenCalledWith('p1', {
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
    const model = await service.create('p1', { ...baseDto, type: 'freedraw', points });
    expect(elements.create).toHaveBeenCalledWith(
      expect.objectContaining({ pointsJson: JSON.stringify(points) }),
    );
    expect(model.points).toEqual(points);
  });

  it('broadcasts element.moved on a position update', async () => {
    await service.updatePosition('p1', 'el1', { x: 42, y: 7 });
    expect(elements.update).toHaveBeenCalledWith({ id: 'el1' }, { x: 42, y: 7 });
    expect(realtime.emit).toHaveBeenCalledWith('p1', {
      kind: 'element.moved',
      elementId: 'el1',
      x: 42,
      y: 7,
      points: undefined,
    });
  });

  it('broadcasts element.deleted on remove', async () => {
    await service.remove('p1', 'el1');
    expect(elements.delete).toHaveBeenCalledWith({ id: 'el1' });
    expect(realtime.emit).toHaveBeenCalledWith('p1', {
      kind: 'element.deleted',
      elementId: 'el1',
    });
  });

  it('reorders in one transaction, updating only rows of this project whose index changed', async () => {
    tx.find.mockResolvedValue([
      { id: 'a', zIndex: 0 },
      { id: 'b', zIndex: 1 },
      { id: 'c', zIndex: 2 },
      { id: 'untouched', zIndex: 7 },
    ]);
    await service.reorder('p1', { orderedElementIds: ['a', 'c', 'b', 'foreign'] });
    expect(elements.manager.transaction).toHaveBeenCalledTimes(1);
    expect(tx.find.mock.calls[0][1]).toMatchObject({ where: { projectId: 'p1' } });
    // 'a' kept index 0 and 'untouched' is not in the list; 'foreign' is not in the project.
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), { id: 'c', projectId: 'p1' }, { zIndex: 1 });
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), { id: 'b', projectId: 'p1' }, { zIndex: 2 });
    expect(elements.update).not.toHaveBeenCalled();
    expect(realtime.emit).toHaveBeenCalledWith('p1', {
      kind: 'element.reordered',
      orderedElementIds: ['a', 'c', 'b', 'foreign'],
    });
  });
});
