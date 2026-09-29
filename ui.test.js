const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('single-file results use a single card and existing-score options stay simple', () => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, children: [], replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); }
    });
    return elements.get(id);
  };
  const context = vm.createContext({ console, document: {
    addEventListener() {}, getElementById: get, createElement: () => ({ innerHTML: '', className: '' })
  } });
  vm.runInContext(fs.readFileSync('public/evaluation.js', 'utf8'), context);
  vm.runInContext("currentTask = { id: 'task', compareFile: { name: 'candidate.xlsx' } }", context);
  const stats = { overall: { average_score: 0.8, total_questions: 2 } };
  context.displayResults([{ type: 'compare', fileName: 'candidate.xlsx', statistics: stats }], [stats]);
  assert.equal(get('resultsContent').children.length, 1);
  assert.match(get('resultsContent').children[0].innerHTML, /candidate/);
  vm.runInContext("currentTask.fileConfigs = { compareFile: { name: 'GPT-4.1' } }", context);
  assert.equal(context.modelDisplayName('compare'), 'GPT-4.1');
  assert.match(context.createFileConfigCard({ name: 'scored.xlsx' }, 'base', 'Base', true, true).innerHTML, /重新评分/);
  assert.doesNotMatch(context.createFileConfigCard({ name: 'new.xlsx' }, 'compare', '对比', false, true).innerHTML, /checkbox/);
});
