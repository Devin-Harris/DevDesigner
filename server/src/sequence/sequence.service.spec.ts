import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SequenceService } from './sequence.service';
import type { SequenceDiagramEntity } from './sequence-diagram.entity';
import type { LifelineEntity } from './lifeline.entity';
import type { SequenceMessageEntity } from './sequence-message.entity';
import type { Project } from '../projects/project.entity';
import type { AccessService } from '../access/access.service';
import type { RealtimePublisher } from '../realtime/realtime.publisher';

/**
 * Sequence routes carry the projectId in the path (authorized by the guard), so the
 * service must scope every child lookup by it and check message endpoints.
 */
describe('SequenceService project scoping', () => {
  const rows = { diagram: { id: 'd1', projectId: 'A' }, lifeline: { id: 'l1', projectId: 'A', diagramId: 'd1' } };
  const diagrams = { findOne: jest.fn(async ({ where }: { where: { id: string; projectId: string } }) => (where.projectId === 'A' && where.id === 'd1' ? rows.diagram : null)) };
  const lifelines = {
    findOne: jest.fn(async ({ where }: { where: { id: string; projectId: string } }) => (where.projectId === 'A' && where.id === 'l1' ? rows.lifeline : null)),
    update: jest.fn(async ({ projectId }: { projectId: string }) => ({ affected: projectId === 'A' ? 1 : 0 })),
    save: jest.fn(),
  };
  const messages = { create: jest.fn((v) => v), save: jest.fn(async (v) => ({ id: 'm1', ...v })) };
  const access = { assertIdsInProject: jest.fn() };
  const realtime = { emit: jest.fn() };
  const service = new SequenceService(
    diagrams as unknown as Repository<SequenceDiagramEntity>,
    lifelines as unknown as Repository<LifelineEntity>,
    messages as unknown as Repository<SequenceMessageEntity>,
    {} as Repository<Project>,
    access as unknown as AccessService,
    realtime as unknown as RealtimePublisher,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.assertIdsInProject.mockResolvedValue(undefined);
  });

  it("404s a lifeline of project A addressed through project B's path", async () => {
    await expect(service.updateLifeline('B', 'l1', { label: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.moveLifeline('B', 'l1', { x: 1 })).rejects.toBeInstanceOf(NotFoundException);
    expect(lifelines.save).not.toHaveBeenCalled();
    expect(realtime.emit).not.toHaveBeenCalled();
  });

  it('refuses a message whose endpoints are not lifelines of the project (security L-7)', async () => {
    access.assertIdsInProject.mockRejectedValue(new BadRequestException('Lifeline x is not part of this project.'));
    await expect(
      service.createMessage('A', { diagramId: 'd1', fromLifelineId: 'l1', toLifelineId: 'foreign', y: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(access.assertIdsInProject).toHaveBeenCalledWith('lifeline', ['l1', 'foreign'], 'A');
    expect(messages.save).not.toHaveBeenCalled();
  });
});
