import { matchDiagrams, matchLifelines, matchMessages } from './sequence-match';

const ll = (id: string, label: string, x: number, morphId?: string) => ({ id, label, x, morphId });
const msg = (
  id: string,
  from: string,
  to: string,
  label: string,
  y: number,
  extra: { morphId?: string; style?: string } = {},
) => ({ id, fromLifelineId: from, toLifelineId: to, label, y, style: extra.style ?? 'solid', morphId: extra.morphId });

describe('matchLifelines', () => {
  it('pairs by label, then similar label, then by seat when counts agree', () => {
    const a = [ll('a1', 'Client', 100), ll('a2', 'API', 260), ll('a3', 'Store', 420)];
    const b = [ll('b1', 'Client', 100), ll('b2', 'API Gateway', 260), ll('b3', 'Database', 420)];
    const pairs = matchLifelines(a, b);
    expect(pairs.sort()).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('does not seat-pair when the leftover counts differ (a participant appeared)', () => {
    const a = [ll('a1', 'Client', 100)];
    const b = [ll('b1', 'Client', 100), ll('b2', 'Cache', 260)];
    expect(matchLifelines(a, b)).toEqual([[0, 0]]);
  });

  it('pairs tagged participants only with the same tag, even when the label differs', () => {
    const a = [ll('a1', 'Browser', 100, 'tag:caller'), ll('a2', 'Web', 260)];
    const b = [ll('b1', 'Web', 100), ll('b2', 'Phone App', 260, 'tag:caller')];
    expect(matchLifelines(a, b).sort()).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it('keeps a tagged participant out of look-alike matching', () => {
    const a = [ll('a1', 'API', 100, 'tag:one')];
    const b = [ll('b1', 'API', 100)];
    expect(matchLifelines(a, b)).toEqual([]);
  });
});

describe('matchMessages', () => {
  const la = [ll('a1', 'A', 100), ll('a2', 'B', 260)];
  const lb = [ll('b1', 'A', 100), ll('b2', 'B', 260)];
  const lp: Array<[number, number]> = [
    [0, 0],
    [1, 1],
  ];

  it('pairs identical messages and keeps earlier rows in place when the diagram grows', () => {
    const a = [msg('m1', 'a1', 'a2', 'hello', 10), msg('m2', 'a2', 'a1', 'ok', 20)];
    const b = [
      msg('n1', 'b1', 'b2', 'hello', 10),
      msg('n2', 'b2', 'b1', 'ok', 20),
      msg('n3', 'b1', 'b2', 'more', 30),
    ];
    expect(matchMessages(a, b, lp, la, lb).sort()).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('pairs a message whose wording was edited (same ends, same step)', () => {
    const a = [msg('m1', 'a1', 'a2', 'create user', 10)];
    const b = [msg('n1', 'b1', 'b2', 'register account', 10)];
    expect(matchMessages(a, b, lp, la, lb)).toEqual([[0, 0]]);
  });

  it('pairs by tag across different ends and wording, and keeps tags exclusive', () => {
    const a = [msg('m1', 'a1', 'a2', 'ping', 10, { morphId: 'tag:p' }), msg('m2', 'a1', 'a2', 'x', 20)];
    const b = [msg('n1', 'b2', 'b1', 'pong', 10), msg('n2', 'b2', 'b1', 'pong2', 20, { morphId: 'tag:p' })];
    const pairs = matchMessages(a, b, lp, la, lb);
    expect(pairs).toContainEqual([0, 1]);
    // The untagged look-alike on the other side never takes the tagged one.
    expect(pairs.filter(([i]) => i === 0)).toHaveLength(1);
  });

  it('treats an unpaired participant as its own end, so only the same wording re-targets', () => {
    const a = [msg('m1', 'a1', 'a2', 'x', 10)];
    expect(matchMessages(a, [msg('n1', 'b1', 'b2', 'y', 10)], [[0, 0]], la, lb)).toEqual([]);
    expect(matchMessages(a, [msg('n1', 'b1', 'b2', 'x', 10)], [[0, 0]], la, lb)).toEqual([[0, 0]]);
  });
});

describe('matchDiagrams', () => {
  const d = (id: string, labels: string[], morphId?: string, title?: string) => ({
    id,
    title,
    morphId,
    lifelines: labels.map((l, i) => ll(`${id}-${i}`, l, i * 100)),
  });

  it('pairs by shared participants (at least half)', () => {
    expect(matchDiagrams([d('a', ['A', 'B', 'C'])], [d('b', ['A', 'B', 'D'])])).toEqual([[0, 0]]);
    expect(matchDiagrams([d('a', ['A', 'B', 'C', 'D'])], [d('b', ['A', 'X', 'Y', 'Z'])])).toEqual([]);
  });

  it('pairs tagged diagrams only by tag', () => {
    const pairs = matchDiagrams(
      [d('a', ['A', 'B'], 'tag:flow')],
      [d('b', ['A', 'B']), d('c', ['X', 'Y'], 'tag:flow')],
    );
    expect(pairs).toEqual([[0, 1]]);
  });
});
