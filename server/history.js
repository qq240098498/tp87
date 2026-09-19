const crypto = require('crypto');
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');

// 改动记录与回退都只关心这几项内容字段
const SNAPSHOT_FIELDS = ['projectId', 'name', 'version', 'license', 'owner', 'status', 'note'];

function snapshotOf(dep) {
  const snap = {};
  SNAPSHOT_FIELDS.forEach((key) => { snap[key] = dep[key]; });
  return snap;
}

// 每次保存登记都追加一条改动记录：时刻、属于哪条登记、改动前后的完整内容。
// 记录只增不改，回退留下的记录也一样，中间的历史不会被抹掉
function recordChange(data, depId, kind, before, after, revertedFrom) {
  const record = {
    id: crypto.randomUUID(),
    depId,
    kind,
    changedAt: new Date().toISOString(),
    before: before ? snapshotOf(before) : null,
    after: snapshotOf(after),
  };
  if (revertedFrom) record.revertedFrom = revertedFrom;
  data.history.push(record);
  return record;
}

function findDepOrFail(data, depId) {
  const dep = data.deps.find((item) => item.id === depId);
  if (!dep) throw new ApiError(404, 'DEP_NOT_FOUND', '这条依赖登记不存在或已被删除', '');
  return dep;
}

function findRecordOrFail(data, depId, recordId) {
  const record = data.history.find((item) => item.id === recordId && item.depId === depId);
  if (!record) throw new ApiError(404, 'RECORD_NOT_FOUND', '这条改动记录不存在，或者不属于这条登记', '');
  return record;
}

// 改动记录按时刻从新到旧给出
function listHistory(depId) {
  const data = load();
  const dep = findDepOrFail(data, depId);
  const records = data.history
    .filter((item) => item.depId === dep.id)
    .slice()
    .sort((a, b) => (a.changedAt > b.changedAt ? -1 : a.changedAt < b.changedAt ? 1 : 0));
  return { dep, records };
}

function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/.exec(text);
  if (!match) return null;
  return { nums: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] || '' };
}

// 预发布后缀按段比较：数字段按数值比，数字排在字母前，前缀相同则段数多的更新
function comparePrerelease(a, b) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const partsA = a.split('.');
  const partsB = b.split('.');
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    if (partsA[i] === undefined) return -1;
    if (partsB[i] === undefined) return 1;
    if (partsA[i] === partsB[i]) continue;
    const numA = /^\d+$/.test(partsA[i]);
    const numB = /^\d+$/.test(partsB[i]);
    if (numA && numB) return Number(partsA[i]) < Number(partsB[i]) ? -1 : 1;
    if (numA) return -1;
    if (numB) return 1;
    return partsA[i] < partsB[i] ? -1 : 1;
  }
  return 0;
}

// 比较两个版本：给出谁新谁旧，以及差在第几段数字上；三段数字都相同就看预发布后缀
function compareVersions(a, b) {
  if (a === b) {
    return { relation: 'same', segment: null, message: `两条记录的版本相同，都是 ${a}` };
  }
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) {
    return { relation: 'unknown', segment: null, message: `两条记录的版本分别是 ${a} 与 ${b}，写法不合三段数字的口径，没法判断高低` };
  }
  for (let i = 0; i < 3; i += 1) {
    if (parsedA.nums[i] !== parsedB.nums[i]) {
      const aNewer = parsedA.nums[i] > parsedB.nums[i];
      const newerNum = aNewer ? parsedA.nums[i] : parsedB.nums[i];
      const olderNum = aNewer ? parsedB.nums[i] : parsedA.nums[i];
      return {
        relation: aNewer ? 'a-newer' : 'b-newer',
        segment: i + 1,
        message: `${aNewer ? a : b} 比 ${aNewer ? b : a} 新，差在第 ${i + 1} 段数字（${newerNum} 对 ${olderNum}）`,
      };
    }
  }
  const pre = comparePrerelease(parsedA.pre, parsedB.pre);
  if (pre === 0) {
    return { relation: 'same', segment: null, message: `两条记录的版本数字相同，都是 ${a}` };
  }
  const aNewer = pre > 0;
  const newerPre = (aNewer ? parsedA.pre : parsedB.pre) || '正式版';
  const olderPre = (aNewer ? parsedB.pre : parsedA.pre) || '正式版';
  return {
    relation: aNewer ? 'a-newer' : 'b-newer',
    segment: 'prerelease',
    message: `${aNewer ? a : b} 比 ${aNewer ? b : a} 新，三段数字相同，差在预发布后缀（${newerPre} 对 ${olderPre}）`,
  };
}

const COMPARE_FIELDS = [
  ['projectId', '所属项目'],
  ['name', '依赖名称'],
  ['version', '版本'],
  ['license', '许可'],
  ['owner', '责任人'],
  ['status', '状态'],
  ['note', '备注'],
];

// 对比同一条登记的两条改动记录：逐项列出差异，版本另外给出高低关系
function compareRecords(depId, aId, bId) {
  const a = pickText(aId);
  const b = pickText(bId);
  if (!a || !b) throw new ApiError(400, 'COMPARE_NEED_TWO', '请选中两条改动记录再对比', '');
  if (a === b) throw new ApiError(400, 'COMPARE_SAME_RECORD', '要选中两条不同的改动记录才能对比', '');
  const data = load();
  findDepOrFail(data, depId);
  const recordA = findRecordOrFail(data, depId, a);
  const recordB = findRecordOrFail(data, depId, b);
  const snapA = recordA.after;
  const snapB = recordB.after;
  const fields = COMPARE_FIELDS.map(([key, label]) => ({
    key,
    label,
    a: snapA[key],
    b: snapB[key],
    changed: snapA[key] !== snapB[key],
  }));
  return {
    a: { id: recordA.id, kind: recordA.kind, changedAt: recordA.changedAt },
    b: { id: recordB.id, kind: recordB.kind, changedAt: recordB.changedAt },
    fields,
    version: compareVersions(snapA.version, snapB.version),
  };
}

// 回退到这条登记自己的某一条记录：内容恢复成那条记录保存的样子，
// 这次回退本身也追加一条新记录，中间的历史一条都不动
function revertDep(depId, payload) {
  const recordId = pickText(payload && payload.recordId);
  if (!recordId) throw new ApiError(400, 'RECORD_REQUIRED', '请指定要回退到哪一条改动记录', '');
  const data = load();
  const dep = findDepOrFail(data, depId);
  const record = findRecordOrFail(data, depId, recordId);
  const target = record.after;

  const project = data.projects.find((item) => item.id === target.projectId);
  if (!project) {
    throw new ApiError(409, 'REVERT_PROJECT_MISSING', '那条记录所属的项目已经被删除，没法回退到这条记录', '');
  }
  const clash = data.deps.find((item) => item.projectId === target.projectId
    && item.id !== dep.id
    && item.name.toLowerCase() === target.name.toLowerCase());
  if (clash) {
    throw new ApiError(409, 'DEP_DUPLICATED', `回退之后会和 ${project.name} 下的 ${clash.name} 重名，先处理那条登记再回退`, '');
  }

  const before = snapshotOf(dep);
  SNAPSHOT_FIELDS.forEach((key) => { dep[key] = target[key]; });
  dep.updatedAt = new Date().toISOString();
  recordChange(data, dep.id, 'revert', before, dep, record.id);
  save(data);
  return dep;
}

module.exports = {
  listHistory,
  compareRecords,
  revertDep,
  recordChange,
  snapshotOf,
  compareVersions,
};
