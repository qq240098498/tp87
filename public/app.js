// 页面交互：项目清单与依赖登记都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  projects: [],
  deps: [],
  licenses: [],
  statuses: [],
  editingId: '',
  detail: { depId: '', dep: null, records: [] },
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

function formatTime(value, withSeconds) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base;
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

// ---- 登记详情与改动记录 ----

const KIND_LABELS = { create: '新建', update: '修改', revert: '回退' };
const CONTENT_KEYS = ['projectId', 'name', 'version', 'license', 'owner', 'status', 'note'];
const CONTENT_LABELS = [
  ['projectId', '所属项目'],
  ['name', '依赖名称'],
  ['version', '版本'],
  ['license', '许可'],
  ['owner', '责任人'],
  ['status', '状态'],
  ['note', '备注'],
];

function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}

// 空值按列表里的口径显示：许可未填、责任人未指定
function displayValue(key, value) {
  if (key === 'projectId') return projectName(value);
  if (value) return value;
  if (key === 'license') return '未填';
  if (key === 'owner') return '未指定';
  return '—';
}

function sameContent(snap, dep) {
  return CONTENT_KEYS.every((key) => snap[key] === dep[key]);
}

// 记录里保存下来的完整内容，展开时整张列出
function snapshotTable(snap) {
  const rows = CONTENT_LABELS.map(([key, label]) => `<tr><th>${label}</th><td>${escapeHtml(displayValue(key, snap[key]))}</td></tr>`).join('');
  return `<table class="mini"><tbody>${rows}</tbody></table>`;
}

// 每条记录的摘要：改动前后版本、许可、责任人、状态分别是什么，没变的标出来
function recordSummary(rec) {
  const fields = [['version', '版本'], ['license', '许可'], ['owner', '责任人'], ['status', '状态']];
  if (!rec.before) {
    return `登记时的内容：${fields.map(([key, label]) => `${label} ${displayValue(key, rec.after[key])}`).join(' ｜ ')}`;
  }
  return fields.map(([key, label]) => {
    if (rec.before[key] === rec.after[key]) return `${label} ${displayValue(key, rec.after[key])}（未变）`;
    return `${label} ${displayValue(key, rec.before[key])} → ${displayValue(key, rec.after[key])}`;
  }).join(' ｜ ');
}

function revertTargetNote(rec) {
  const target = state.detail.records.find((item) => item.id === rec.revertedFrom);
  return target ? `，回退到了 ${formatTime(target.changedAt, true)} 那条记录` : '';
}

function renderRecord(rec, dep) {
  const revertable = !sameContent(rec.after, dep);
  const revertHint = revertable ? '把登记内容恢复成这条记录保存的样子' : '当前内容已经与这条记录一致';
  const revertNote = rec.kind === 'revert' && rec.revertedFrom
    ? `<p class="revert-note">这条记录是一次回退留下的${escapeHtml(revertTargetNote(rec))}</p>`
    : '';
  return `<div class="record">
    <div class="record-head">
      <input type="checkbox" class="record-check" data-compare-check="${escapeHtml(rec.id)}" title="勾选两条记录后可以对比">
      <span class="mono record-time">${escapeHtml(formatTime(rec.changedAt, true))}</span>
      <span class="tag kind-${escapeHtml(rec.kind)}">${escapeHtml(kindLabel(rec.kind))}</span>
      <span class="record-summary">${escapeHtml(recordSummary(rec))}</span>
      <button type="button" class="link" data-record-toggle="${escapeHtml(rec.id)}">展开</button>
      <button type="button" class="link danger" data-record-revert="${escapeHtml(rec.id)}" ${revertable ? '' : 'disabled'} title="${revertHint}">回退到这条</button>
    </div>
    <div class="record-detail hidden" data-record-detail="${escapeHtml(rec.id)}">
      ${revertNote}
      <div class="snapshot-cols">
        <div><h4>改动前</h4>${rec.before ? snapshotTable(rec.before) : '<p class="missing">新建登记，没有改动前的内容</p>'}</div>
        <div><h4>改动后</h4>${snapshotTable(rec.after)}</div>
      </div>
    </div>
  </div>`;
}

function renderDetail() {
  const { dep, records } = state.detail;
  if (!dep) return;
  el('detail-title').textContent = `登记详情：${dep.name}`;
  const cells = CONTENT_LABELS.map(([key, label]) => ({ label, value: displayValue(key, dep[key]), mono: key === 'name' || key === 'version' }));
  cells.push({ label: '登记时间', value: formatTime(dep.createdAt), mono: true });
  cells.push({ label: '更新时间', value: formatTime(dep.updatedAt), mono: true });
  el('detail-current').innerHTML = cells.map((cell) => `<div class="kv"><span class="k">${cell.label}</span><span class="v${cell.mono ? ' mono' : ''}">${escapeHtml(cell.value)}</span></div>`).join('');

  el('history-empty').classList.toggle('hidden', records.length > 0);
  el('history-list').innerHTML = records.map((rec) => renderRecord(rec, dep)).join('');
}

async function openDetail(depId) {
  try {
    const payload = await request(`/api/deps/${encodeURIComponent(depId)}/history`);
    state.detail.depId = depId;
    state.detail.dep = payload.dep;
    state.detail.records = payload.records || [];
    el('compare-result').classList.add('hidden');
    el('compare-result').innerHTML = '';
    el('dep-detail').classList.remove('hidden');
    renderDetail();
    el('dep-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    notify(err.message, 'error');
  }
}

function closeDetail() {
  state.detail = { depId: '', dep: null, records: [] };
  el('dep-detail').classList.add('hidden');
}

// 对比选中的两条记录：较早的放在甲位，逐项列差异，版本高低由服务端给出
async function runCompare() {
  clearNotice();
  const checked = Array.from(document.querySelectorAll('[data-compare-check]:checked'))
    .map((node) => node.dataset.compareCheck);
  if (checked.length !== 2) {
    notify(checked.length < 2 ? '先勾选两条改动记录再对比' : '一次只能对比两条记录，请只保留两条勾选', 'error');
    return;
  }
  const picked = checked
    .map((id) => state.detail.records.find((item) => item.id === id))
    .filter(Boolean)
    .sort((x, y) => (x.changedAt < y.changedAt ? -1 : 1));
  if (picked.length !== 2) return;
  try {
    const params = new URLSearchParams({ a: picked[0].id, b: picked[1].id });
    const result = await request(`/api/deps/${encodeURIComponent(state.detail.depId)}/history/compare?${params.toString()}`);
    renderCompare(result);
  } catch (err) {
    notify(err.message, 'error');
  }
}

function renderCompare(result) {
  const tagFor = (info) => `${formatTime(info.changedAt, true)}（${kindLabel(info.kind)}）`;
  const rows = result.fields.map((field) => `<tr class="${field.changed ? 'changed' : ''}">
      <td>${escapeHtml(field.label)}</td>
      <td>${escapeHtml(displayValue(field.key, field.a))}</td>
      <td>${escapeHtml(displayValue(field.key, field.b))}</td>
      <td>${field.changed ? '有差异' : '一致'}</td>
    </tr>`).join('');
  el('compare-result').innerHTML = `
    <h3>对比结果</h3>
    <p class="compare-meta">记录甲：${escapeHtml(tagFor(result.a))} ｜ 记录乙：${escapeHtml(tagFor(result.b))}</p>
    <p class="version-relation">${escapeHtml(result.version.message)}</p>
    <table class="grid compare-table">
      <thead><tr><th>对比项</th><th>记录甲</th><th>记录乙</th><th>差异</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  el('compare-result').classList.remove('hidden');
  el('compare-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function revertToRecord(recordId) {
  const rec = state.detail.records.find((item) => item.id === recordId);
  if (!rec) return;
  const when = formatTime(rec.changedAt, true);
  const question = `确定把这条登记回退到 ${when} 那条记录的内容吗？\n回退之后登记内容会与那条记录一致；这次回退本身也会留下一条新的改动记录，中间的历史都会保留。`;
  if (!window.confirm(question)) return;
  try {
    await request(`/api/deps/${encodeURIComponent(state.detail.depId)}/revert`, { method: 'POST', body: JSON.stringify({ recordId }) });
    notify(`已回退到 ${when} 那条记录，这次回退也留下了一条新的改动记录`, 'ok');
    await loadProjects();
    await loadDeps();
    await openDetail(state.detail.depId);
  } catch (err) {
    notify(err.message, 'error');
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
    if (editing && state.detail.depId === editing) await openDetail(editing);
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

  if (node.dataset.depEdit) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depEdit);
    if (found) openDepForm(found);
    return;
  }

  if (node.dataset.depDetail) {
    clearNotice();
    openDetail(node.dataset.depDetail);
    return;
  }

  if (node.dataset.recordToggle) {
    const detail = document.querySelector(`[data-record-detail="${node.dataset.recordToggle}"]`);
    if (detail) {
      detail.classList.toggle('hidden');
      node.textContent = detail.classList.contains('hidden') ? '展开' : '收起';
    }
    return;
  }

  if (node.dataset.recordRevert) {
    clearNotice();
    revertToRecord(node.dataset.recordRevert);
    return;
  }

  if (node.dataset.depDelete) {
    clearNotice();
    const found = state.deps.find((item) => item.id === node.dataset.depDelete);
    if (!window.confirm(`确定删除登记 ${found ? found.name : ''} 吗？`)) return;
    try {
      await request(`/api/deps/${encodeURIComponent(node.dataset.depDelete)}`, { method: 'DELETE' });
      if (state.editingId === node.dataset.depDelete) closeDepForm();
      if (state.detail.depId === node.dataset.depDelete) closeDetail();
      notify('登记已删除', 'ok');
      await loadProjects();
      await loadDeps();
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
el('compare-run').addEventListener('click', runCompare);
el('detail-close').addEventListener('click', closeDetail);
// 勾选变化后之前展示的对比结果就失效了，先收起来
document.addEventListener('change', (event) => {
  if (event.target.matches('[data-compare-check]')) {
    el('compare-result').classList.add('hidden');
    el('compare-result').innerHTML = '';
  }
});
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

// 页面打开时先把项目与依赖登记拉一遍，项目决定登记表单里能选哪些归属
restoreOperator();
loadHealth();
loadProjects()
  .then(loadDeps)
  .catch((err) => notify(err.message, 'error'));
