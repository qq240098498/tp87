// 页面交互：项目清单与依赖登记都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
  detail: { depId: '', records: [], expanded: {}, selected: [] },
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：项目区与依赖区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' ? target : target.querySelector('input, select');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 改动记录里的时刻精确到秒，连续保存两次也分得开
function formatTimeFull(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 操作者名字记在浏览器里，刷新之后还在，保存时随请求一起带上
const OPERATOR_KEY = 'dep-ledger-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadProjects() {
  const payload = await request('/api/projects');
  state.projects = payload.projects || [];
  renderProjects();
  renderProjectOptions();
}

async function loadDeps() {
  const params = new URLSearchParams();
  const projectId = el('filter-project').value;
  const status = el('filter-status').value;
  const license = el('filter-license').value;
  const keyword = el('filter-keyword').value.trim();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  if (license) params.set('license', license);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/deps${query ? `?${query}` : ''}`);
  state.deps = payload.deps || [];
  state.licenses = payload.licenses || [];
  state.statuses = payload.statuses || [];
  renderDepFilterOptions();
  renderDeps();
}

function renderProjects() {
  const body = el('project-body');
  body.innerHTML = state.projects.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.owner) || '<span class="missing">未指定</span>'}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td>${item.depCount} 条</td>
      <td class="mono">${escapeHtml(formatTime(item.createdAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-project-rename="${escapeHtml(item.id)}">改名</button>
        <button type="button" class="link" data-project-owner="${escapeHtml(item.id)}">改负责人</button>
        <button type="button" class="link danger" data-project-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('project-empty').classList.toggle('hidden', state.projects.length > 0);
}

function renderProjectOptions() {
  const select = el('dep-project');
  const current = select.value;
  select.innerHTML = state.projects
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
  if (state.projects.some((item) => item.id === current)) select.value = current;

  const filter = el('filter-project');
  const filterCurrent = filter.value;
  filter.innerHTML = '<option value="">全部项目</option>'
    + state.projects.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (state.projects.some((item) => item.id === filterCurrent)) filter.value = filterCurrent;
}

function renderDepFilterOptions() {
  const statusSelect = el('filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const licenseSelect = el('filter-license');
  const licenseCurrent = licenseSelect.value;
  licenseSelect.innerHTML = '<option value="">全部许可</option>'
    + state.licenses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.licenses.includes(licenseCurrent)) licenseSelect.value = licenseCurrent;

  const statusForm = el('dep-status');
  const statusFormCurrent = statusForm.value;
  statusForm.innerHTML = state.statuses
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join('');
  if (state.statuses.includes(statusFormCurrent)) statusForm.value = statusFormCurrent;
}

function projectName(projectId) {
  const found = state.projects.find((item) => item.id === projectId);
  return found ? found.name : projectId;
}

function renderDeps() {
  const body = el('dep-body');
  body.innerHTML = state.deps.map((item) => {
    const statusTag = item.status === '已弃用' ? 'off' : 'on';
    return `<tr>
      <td>${escapeHtml(projectName(item.projectId))}</td>
      <td class="mono">${escapeHtml(item.name)}</td>
      <td class="mono">${escapeHtml(item.version)}</td>
      <td>${item.license ? escapeHtml(item.license) : '<span class="missing">未填</span>'}</td>
      <td>${item.owner ? escapeHtml(item.owner) : '<span class="missing">未指定</span>'}</td>
      <td><span class="tag ${statusTag}">${escapeHtml(item.status)}</span></td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-dep-detail="${escapeHtml(item.id)}">详情</button>
        <button type="button" class="link" data-dep-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-dep-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('dep-empty').classList.toggle('hidden', state.deps.length > 0);
}

function openDepForm(dep) {
  state.editingId = dep ? dep.id : '';
  el('dep-form-title').textContent = dep ? `编辑登记：${dep.name}` : '新建登记';
  if (state.projects.length) {
    el('dep-project').value = dep ? dep.projectId : state.projects[0].id;
  }
  el('dep-name').value = dep ? dep.name : '';
  el('dep-version').value = dep ? dep.version : '';
  el('dep-license').value = dep ? dep.license : '';
  el('dep-owner').value = dep ? dep.owner : currentOperator();
  el('dep-status').value = dep ? dep.status : (state.statuses[0] || '在用');
  el('dep-note').value = dep ? dep.note : '';
  el('dep-form').classList.remove('hidden');
  el('dep-name').focus();
}

function closeDepForm() {
  state.editingId = '';
  el('dep-form').classList.add('hidden');
  clearFieldMarks();
}

// ---------- 登记详情：改动记录、逐条展开、两条对比、回退 ----------

const ACTION_LABEL = { create: '新增', update: '修改', rollback: '回退' };
const VERSION_SEGMENTS = ['主版本号', '次版本号', '修订号'];

// 一份登记内容（当前内容或某条记录保存的内容）渲染成一排小项
function contentItems(snapshot) {
  const items = [
    ['所属项目', escapeHtml(projectName(snapshot.projectId))],
    ['依赖名称', `<span class="mono">${escapeHtml(snapshot.name)}</span>`],
    ['版本', `<span class="mono">${escapeHtml(snapshot.version)}</span>`],
    ['许可', snapshot.license ? escapeHtml(snapshot.license) : '<span class="missing">未填</span>'],
    ['责任人', snapshot.owner ? escapeHtml(snapshot.owner) : '<span class="missing">未指定</span>'],
    ['状态', escapeHtml(snapshot.status)],
    ['备注', snapshot.note ? escapeHtml(snapshot.note) : '<span class="missing">（空）</span>'],
  ];
  return items.map(([key, value]) => `<div class="detail-item"><div class="k">${key}</div><div class="v">${value}</div></div>`).join('');
}

// 记录行里的一格：新增时只有改后的值，没变时只显示一个值，变了就显示 前 → 后
function changeCell(record, field, kind) {
  const render = (value) => {
    if (kind === 'version') return `<span class="mono">${escapeHtml(value)}</span>`;
    if (kind === 'license') return value ? escapeHtml(value) : '<span class="missing">未填</span>';
    if (kind === 'owner') return value ? escapeHtml(value) : '<span class="missing">未指定</span>';
    return escapeHtml(value);
  };
  const after = record.after[field];
  if (!record.before) return `<span class="diff-new">${render(after)}</span>`;
  const before = record.before[field];
  if (before === after) return `<span class="diff-same">${render(after)}</span>`;
  return `<span class="diff-old">${render(before)}</span><span class="diff-arrow">→</span><span class="diff-new">${render(after)}</span>`;
}

// 展开一条记录：把它保存下来的完整内容摆出来，回退记录还会注明是从哪条记录回退来的
function renderRecordExpand(record) {
  const beforeLine = record.before
    ? `<div class="record-full-before">这次改动前：版本 ${escapeHtml(record.before.version)} · 许可 ${escapeHtml(record.before.license) || '未填'} · 责任人 ${escapeHtml(record.before.owner) || '未指定'} · 状态 ${escapeHtml(record.before.status)}</div>`
    : '';
  const rollbackLine = record.action === 'rollback' && record.rollbackOf
    ? `<div class="record-full-before">这条记录由回退产生，回退到的目标记录编号是 <span class="mono">${escapeHtml(record.rollbackOf)}</span></div>`
    : '';
  return `<tr class="history-expand"><td colspan="8">
    <div class="record-full">
      <div class="record-full-head">这条记录保存的完整内容（${ACTION_LABEL[record.action] || record.action} · ${escapeHtml(formatTimeFull(record.changedAt))}）</div>
      <div class="record-full-items">${contentItems(record.after)}</div>
      ${beforeLine}
      ${rollbackLine}
    </div>
  </td></tr>`;
}

function renderHistory() {
  const body = el('history-body');
  const { records, expanded, selected } = state.detail;
  body.innerHTML = records.map((record) => {
    const isOpen = !!expanded[record.id];
    const checked = selected.includes(record.id) ? 'checked' : '';
    const main = `<tr>
      <td><input type="checkbox" data-history-select="${escapeHtml(record.id)}" ${checked} aria-label="选这条记录做对比"></td>
      <td class="mono">${escapeHtml(formatTimeFull(record.changedAt))}</td>
      <td><span class="tag action-${escapeHtml(record.action)}">${escapeHtml(ACTION_LABEL[record.action] || record.action)}</span></td>
      <td>${changeCell(record, 'version', 'version')}</td>
      <td>${changeCell(record, 'license', 'license')}</td>
      <td>${changeCell(record, 'owner', 'owner')}</td>
      <td>${changeCell(record, 'status', 'text')}</td>
      <td class="actions">
        <button type="button" class="link" data-history-toggle="${escapeHtml(record.id)}">${isOpen ? '收起' : '展开'}</button>
        <button type="button" class="link" data-history-rollback="${escapeHtml(record.id)}">回退到这条</button>
      </td>
    </tr>`;
    return isOpen ? main + renderRecordExpand(record) : main;
  }).join('');
  el('history-empty').classList.toggle('hidden', records.length > 0);
}

function parseVersionParts(text) {
  const match = String(text).match(/^(\d+)\.(\d+)\.(\d+)(-([0-9A-Za-z.]+))?$/);
  if (!match) return null;
  return { nums: [Number(match[1]), Number(match[2]), Number(match[3])], suffix: match[5] || '' };
}

// 两个版本谁比谁新、差在第几段数字；三段数字都一样时再看预发布后缀
function versionRelationText(olderVersion, newerVersion) {
  const older = parseVersionParts(olderVersion);
  const newer = parseVersionParts(newerVersion);
  if (!older || !newer) return '两条记录的版本写法不一致，没法比较高低';
  for (let i = 0; i < 3; i += 1) {
    if (older.nums[i] === newer.nums[i]) continue;
    const laterIsHigher = newer.nums[i] > older.nums[i];
    const hi = laterIsHigher ? newerVersion : olderVersion;
    const lo = laterIsHigher ? olderVersion : newerVersion;
    const hiNum = laterIsHigher ? newer.nums[i] : older.nums[i];
    const loNum = laterIsHigher ? older.nums[i] : newer.nums[i];
    return `较晚记录的版本${laterIsHigher ? '更新' : '更低'}：${hi} 比 ${lo} 新，差在第 ${i + 1} 段数字（${VERSION_SEGMENTS[i]}，${hiNum} 对 ${loNum}）`;
  }
  if (older.suffix === newer.suffix) return '两条记录的版本完全相同';
  if (!older.suffix || !newer.suffix) {
    const laterIsHigher = !newer.suffix;
    const hi = laterIsHigher ? newerVersion : olderVersion;
    const lo = laterIsHigher ? olderVersion : newerVersion;
    return `三段数字相同，${hi} 比 ${lo} 新（${lo} 带预发布后缀，正式版更高）`;
  }
  const laterIsHigher = newer.suffix > older.suffix;
  const hi = laterIsHigher ? newerVersion : olderVersion;
  const lo = laterIsHigher ? olderVersion : newerVersion;
  return `三段数字相同，预发布后缀不同，按后缀字面顺序 ${hi} 比 ${lo} 新`;
}

// 选中两条记录后逐项列出差异；版本那一项额外给出谁比谁新、差在第几段数字
function renderCompare() {
  const area = el('compare-area');
  const picked = state.detail.records.filter((record) => state.detail.selected.includes(record.id));
  if (picked.length !== 2) {
    area.classList.add('hidden');
    area.innerHTML = '';
    return;
  }
  // records 本来就是新→旧排好的，排前面的那条更晚
  const newer = picked[0];
  const older = picked[1];
  const head = (record) => `${escapeHtml(formatTimeFull(record.changedAt))} · ${escapeHtml(ACTION_LABEL[record.action] || record.action)}`;
  const fields = [
    ['version', '版本'],
    ['license', '许可'],
    ['owner', '责任人'],
    ['status', '状态'],
    ['name', '依赖名称'],
    ['projectId', '所属项目'],
    ['note', '备注'],
  ];
  const display = (field, value) => {
    if (field === 'projectId') return escapeHtml(projectName(value));
    if (field === 'version' || field === 'name') return `<span class="mono">${escapeHtml(value)}</span>`;
    return value ? escapeHtml(value) : '<span class="missing">（空）</span>';
  };
  const rows = fields.map(([field, label]) => {
    const olderValue = older.after[field];
    const newerValue = newer.after[field];
    const same = olderValue === newerValue;
    let verdict = '<span class="cmp-same">无变化</span>';
    if (!same && field === 'version') {
      verdict = `<span class="cmp-diff">${escapeHtml(versionRelationText(olderValue, newerValue))}</span>`;
    } else if (!same) {
      verdict = '<span class="cmp-diff">有改动</span>';
    }
    return `<tr class="${same ? '' : 'cmp-row-diff'}">
      <td>${label}</td>
      <td>${display(field, olderValue)}</td>
      <td>${display(field, newerValue)}</td>
      <td>${verdict}</td>
    </tr>`;
  }).join('');
  area.innerHTML = `<h3>两条记录对比</h3>
    <div class="table-wrap">
      <table class="grid compare-grid">
        <thead><tr><th>对比项</th><th>较早记录（${head(older)}）</th><th>较晚记录（${head(newer)}）</th><th>对比结果</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  area.classList.remove('hidden');
}

function renderDepDetail(dep) {
  el('dep-detail').classList.remove('hidden');
  el('detail-title').textContent = `登记详情：${dep.name}`;
  el('detail-current').innerHTML = contentItems(dep)
    + `<div class="detail-item"><div class="k">更新时间</div><div class="v mono">${escapeHtml(formatTime(dep.updatedAt))}</div></div>`;
  renderHistory();
  renderCompare();
}

// 拉取某条登记与它的改动记录；keepView 时保留已经展开和已经勾选的记录
async function loadDepDetail(depId, keepView) {
  const payload = await request(`/api/deps/${encodeURIComponent(depId)}/history`);
  const records = payload.records || [];
  const prev = state.detail;
  state.detail = {
    depId,
    records,
    expanded: keepView ? prev.expanded : {},
    selected: keepView ? prev.selected.filter((id) => records.some((record) => record.id === id)) : [],
  };
  renderDepDetail(payload.dep);
}

function closeDepDetail() {
  state.detail = { depId: '', records: [], expanded: {}, selected: [] };
  el('dep-detail').classList.add('hidden');
}

// 保存或删除之后详情区还开着就顺手刷新；登记已经不在了就把它收起来
async function refreshDetailIfOpen() {
  if (!state.detail.depId) return;
  try {
    await loadDepDetail(state.detail.depId, true);
  } catch (err) {
    closeDepDetail();
  }
}

async function submitProject(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    name: el('project-name').value,
    owner: el('project-owner').value,
    note: el('project-note').value,
  };
  try {
    await request('/api/projects', { method: 'POST', body: JSON.stringify(payload) });
    el('project-name').value = '';
    el('project-owner').value = '';
    el('project-note').value = '';
    notify('项目已新增', 'ok');
    await loadProjects();
    await loadDeps();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitDep(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    projectId: el('dep-project').value,
    name: el('dep-name').value,
    version: el('dep-version').value,
    license: el('dep-license').value,
    owner: el('dep-owner').value,
    status: el('dep-status').value,
    note: el('dep-note').value,
  };
  const editing = state.editingId;
  try {
    if (editing) {
      await request(`/api/deps/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('依赖登记已保存', 'ok');
    } else {
      await request('/api/deps', { method: 'POST', body: JSON.stringify(payload) });
      notify('依赖登记已新增', 'ok');
    }
    closeDepForm();
    await loadProjects();
    await loadDeps();
    await refreshDetailIfOpen();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  const projectId = node.dataset.projectRename || node.dataset.projectOwner || node.dataset.projectDelete;
  if (projectId) {
    clearNotice();
    const found = state.projects.find((item) => item.id === projectId);
    if (!found) return;
    try {
      if (node.dataset.projectRename) {
        const next = window.prompt(`把 ${found.name} 的名称改成`, found.name);
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
        notify('项目名称已更新', 'ok');
      } else if (node.dataset.projectOwner) {
        const next = window.prompt(`把 ${found.name} 的负责人改成`, found.owner || '');
        if (next === null) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify({ owner: next }) });
        notify('项目负责人已更新', 'ok');
      } else {
        if (!window.confirm(`确定删除项目 ${found.name} 吗？`)) return;
        await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
        notify('项目已删除', 'ok');
      }
      await loadProjects();
      await loadDeps();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.depDetail) {
    clearNotice();
    try {
      await loadDepDetail(node.dataset.depDetail, false);
      el('dep-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.depEdit) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depEdit);
    if (found) openDepForm(found);
    return;
  }

  if (node.dataset.depDelete) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depDelete);
    if (!window.confirm(`确定删除登记 ${found ? found.name : ''} 吗？`)) return;
    try {
      await request(`/api/deps/${encodeURIComponent(node.dataset.depDelete)}`, { method: 'DELETE' });
      if (state.editingId === node.dataset.depDelete) closeDepForm();
      notify('登记已删除', 'ok');
      await loadProjects();
      await loadDeps();
      await refreshDetailIfOpen();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  // 展开或收起一条改动记录保存的完整内容
  if (node.dataset.historyToggle) {
    const id = node.dataset.historyToggle;
    state.detail.expanded[id] = !state.detail.expanded[id];
    renderHistory();
    return;
  }

  // 回退到某一条记录：先确认，回退后详情区会多出一条“回退”记录
  if (node.dataset.historyRollback) {
    clearNotice();
    const record = state.detail.records.find((item) => item.id === node.dataset.historyRollback);
    const depId = state.detail.depId;
    if (!record || !depId) return;
    const found = state.deps.find((item) => item.id === depId);
    const name = found ? found.name : record.depName;
    if (!window.confirm(`确定把登记「${name}」回退到 ${formatTimeFull(record.changedAt)} 那条记录保存的内容吗？\n\n回退后这条登记的内容会与那条记录一致；这次回退本身也会留下一条新的改动记录，中间的历史不会被抹掉。`)) return;
    try {
      await request(`/api/deps/${encodeURIComponent(depId)}/rollback`, { method: 'POST', body: JSON.stringify({ historyId: record.id }) });
      notify('已回退到那条记录的内容，这次回退也留下了新的改动记录', 'ok');
      await loadProjects();
      await loadDeps();
      await loadDepDetail(depId, true);
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

el('project-form').addEventListener('submit', submitProject);
el('dep-form').addEventListener('submit', submitDep);
el('dep-new').addEventListener('click', () => {
  clearNotice();
  if (!state.projects.length) {
    notify('请先登记一个项目，再登记依赖', 'error');
    return;
  }
  openDepForm(null);
});
el('dep-cancel').addEventListener('click', closeDepForm);
el('filter-apply').addEventListener('click', () => {
  clearNotice();
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-reset').addEventListener('click', () => {
  el('filter-project').value = '';
  el('filter-status').value = '';
  el('filter-license').value = '';
  el('filter-keyword').value = '';
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('dep-refresh').addEventListener('click', () => {
  clearNotice();
  loadProjects()
    .then(loadDeps)
    .catch((err) => notify(err.message, 'error'));
});
el('filter-project').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-status').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('filter-license').addEventListener('change', () => {
  loadDeps().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});
el('detail-close').addEventListener('click', closeDepDetail);

// 勾选两条记录做对比，勾第三条时最早勾的那条自动让位
el('history-body').addEventListener('change', (event) => {
  const box = event.target.closest('input[data-history-select]');
  if (!box) return;
  const id = box.dataset.historySelect;
  const selected = state.detail.selected.filter((item) => item !== id);
  if (box.checked) selected.push(id);
  state.detail.selected = selected.slice(-2);
  renderHistory();
  renderCompare();
});

// 页面打开时先把项目与依赖登记拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(loadDeps)
  .catch((err) => notify(err.message, 'error'));
