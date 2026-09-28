function key(row) {
  return String(row.id ?? '').trim();
}

function indexRows(rows, label) {
  const indexed = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!id) throw new Error(`${label}存在空的 id`);
    if (indexed.has(id)) throw new Error(`${label}存在重复 id: ${id}`);
    indexed.set(id, row);
  }
  return indexed;
}

function pairRows(baseRows, compareRows) {
  const base = indexRows(baseRows, 'Base文件');
  const compare = indexRows(compareRows, 'Compare文件');
  const pairs = [];
  for (const [id, baseRow] of base) {
    const compareRow = compare.get(id);
    if (!compareRow) throw new Error(`Compare文件缺少 id: ${id}`);
    for (const field of ['instruction', 'reference']) {
      if (String(baseRow[field] ?? '').trim() !== String(compareRow[field] ?? '').trim()) {
        throw new Error(`id ${id} 的 ${field} 在两个文件中不一致`);
      }
    }
    pairs.push({ id, base: baseRow, compare: compareRow });
  }
  for (const id of compare.keys()) {
    if (!base.has(id)) throw new Error(`Base文件缺少 id: ${id}`);
  }
  return pairs;
}

function score(row) {
  if (row.score === undefined || row.score === null || String(row.score).trim() === '') return null;
  const value = Number(row.score);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`id ${key(row)} 的 score 必须是 0 到 1 之间的数字`);
  }
  return value;
}

function reviewRows(pairs) {
  return pairs.flatMap(({ id, base, compare }) => {
    const baseScore = score(base);
    const compareScore = score(compare);
    if (baseScore === null || compareScore === null) return [];
    const delta = compareScore - baseScore;
    const reasons = [];
    if (Math.abs(delta) >= 0.5) reasons.push('评分差异较大');
    if (Math.min(baseScore, compareScore) <= 0.4) reasons.push('至少一个答案低分');
    return reasons.length ? [{ id, instruction: base.instruction, baseScore, compareScore,
      delta, baseReason: base.reason || '', compareReason: compare.reason || '',
      reviewReason: reasons.join('；') }] : [];
  });
}

module.exports = { indexRows, pairRows, score, reviewRows };
