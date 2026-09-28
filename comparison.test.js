const test = require('node:test');
const assert = require('node:assert/strict');
const { pairRows, score, reviewRows } = require('./comparison');

const base = [
  { id: 1, instruction: 'first', reference: 'a', score: 1, reason: 'good' },
  { id: 2, instruction: 'second', reference: 'b', score: 0.2, reason: 'missing' }
];
const compare = [
  { id: 2, instruction: 'second', reference: 'b', score: 0.9, reason: 'good' },
  { id: 1, instruction: 'first', reference: 'a', score: 0.9, reason: 'good' }
];

test('pairs by original id, even when rows are reordered', () => {
  const pairs = pairRows(base, compare);
  assert.deepEqual(pairs.map(pair => [pair.id, pair.compare.score]), [['1', 0.9], ['2', 0.9]]);
  assert.deepEqual(reviewRows(pairs).map(row => row.id), ['2']);
});

test('rejects invalid comparison datasets', () => {
  assert.throws(() => pairRows(base, [compare[0], compare[0]]), /重复 id/);
  assert.throws(() => pairRows(base, [compare[0]]), /缺少 id/);
  assert.throws(() => pairRows(base, [{ ...compare[0], instruction: 'different' }, compare[1]]), /instruction/);
  assert.throws(() => pairRows(base, [{ ...compare[0], id: '' }, compare[1]]), /空的 id/);
});

test('missing scores stay missing and invalid scores are rejected', () => {
  assert.equal(score({ id: 1, score: '' }), null);
  assert.throws(() => score({ id: 1, score: 'bad' }), /score/);
  assert.throws(() => score({ id: 1, score: 1.5 }), /score/);
});
