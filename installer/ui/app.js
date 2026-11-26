const wizard = document.querySelector('#wizard');
const loading = document.querySelector('#loading-state');
const stepList = document.querySelector('#step-list');
const versionLabel = document.querySelector('#version-label');

const state = {
  data: null,
  step: 0,
  platform: 'codex',
  customPath: '',
  installResult: null,
  tokenConnected: false,
  job: null,
  verify: null,
  busy: false,
  error: null,
  tokenVisible: false,
  tokenValue: '',
  renderedStep: -1,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name) {
  const paths = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    check: '<path d="m5 12 4.2 4.2L19 6.5"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M19 11a7 7 0 1 0-2 5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function status(label, tone = 'good') {
  return `<span class="status ${tone === 'good' ? '' : tone}">${escapeHtml(label)}</span>`;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({ ok: false, error: '安装向导返回了无效响应。' }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || '操作未完成。');
  return payload;
}

function updateProgress() {
  for (const item of stepList.querySelectorAll('li')) {
    const index = Number(item.dataset.step);
    item.classList.toggle('active', index === state.step);
    item.classList.toggle('done', index < state.step);
  }
}

function setBusy(value) {
  state.busy = value;
  render();
}

function footer({ back = true, skip = '', next = '继续', nextAction = 'next', busyLabel = '处理中…', nextDisabled = false, extra = '' } = {}) {
  const locked = state.busy || state.job?.status === 'running';
  return `<footer class="wizard-footer">
    <div>${back && state.step > 0 ? `<button class="button ghost" data-action="back" ${locked ? 'disabled' : ''}>${icon('back')}上一步</button>` : ''}</div>
    <div class="footer-actions">
      ${extra}
      ${skip ? `<button class="button secondary" data-action="${escapeHtml(skip)}" ${locked ? 'disabled' : ''}>跳过</button>` : ''}
      <button class="button" data-action="${escapeHtml(nextAction)}" ${locked || nextDisabled ? 'disabled' : ''}>
        ${state.busy ? `<span class="spinner" aria-hidden="true"></span>${escapeHtml(busyLabel)}` : `${escapeHtml(next)}${icon('arrow')}`}
      </button>
    </div>
  </footer>`;
}

function environmentStep() {
  const { environment, platforms } = state.data;
  const pythonReady = environment.python.supported;
  const nodeReady = environment.node.supported;
  const npmReady = environment.npm.available;
  return `<section class="step-panel">
    <header class="step-header">
      <div class="step-kicker">第 1 步 / 共 4 步</div>
      <h2>先确认运行环境，<br>再把技能放到正确的位置。</h2>
      <p>基础课程查询需要 Python；PPT 下载和课堂文稿需要 Node.js 22 以上。已经安装过的技能会自动识别。</p>
    </header>
    <div class="step-body">
      <div class="environment-list">
        <div class="environment-row">
          <strong>Python 3.9+</strong>
          <span>${escapeHtml(environment.python.version || '未找到 python / python3')}</span>
          ${pythonReady ? status('可用') : status(environment.python.available ? '版本过低' : '未找到', 'bad')}
        </div>
        <div class="environment-row">
          <strong>Node.js 22.13+</strong>
          <span>v${escapeHtml(environment.node.version)}</span>
          ${nodeReady ? status('可用') : status('版本过低', 'bad')}
        </div>
        <div class="environment-row">
          <strong>npm</strong>
          <span>${escapeHtml(environment.npm.version || '未找到 npm')}</span>
          ${npmReady ? status('可用') : status('未找到', 'warn')}
        </div>
      </div>

      <div class="section-label">
        <h3>安装到哪里</h3>
        <p>技能名称保持为 sjtu-canvas</p>
      </div>
      <div class="target-list" role="radiogroup" aria-label="安装目标">
        ${platforms.map((platform) => `<label class="target-option">
          <input type="radio" name="platform" value="${escapeHtml(platform.id)}" ${state.platform === platform.id ? 'checked' : ''}>
          <span class="radio" aria-hidden="true"></span>
          <span class="target-copy">
            <strong>${escapeHtml(platform.name)}</strong>
            <small>${escapeHtml(platform.description)}</small>
            <code>${escapeHtml(platform.path)}</code>
          </span>
          <span class="target-state">${platform.installed ? '已安装 · 将更新' : '新安装'}</span>
        </label>`).join('')}
        <label class="target-option">
          <input type="radio" name="platform" value="custom" ${state.platform === 'custom' ? 'checked' : ''}>
          <span class="radio" aria-hidden="true"></span>
          <span class="target-copy">
            <strong>自定义目录</strong>
            <small>用于其他兼容 SKILL.md 的智能体</small>
          </span>
          <span class="target-state">高级</span>
        </label>
      </div>
      ${state.platform === 'custom' ? `<div class="custom-path">
        <label for="custom-path">本机绝对目录</label>
        <input class="text-input" id="custom-path" value="${escapeHtml(state.customPath)}" placeholder="C:\\path\\to\\skills\\sjtu-canvas">
      </div>` : ''}
      ${state.error ? `<div class="alert" role="alert">${escapeHtml(state.error)}</div>` : ''}
    </div>
    ${footer({
      back: false,
      next: '安装技能',
      nextAction: 'install',
      busyLabel: '正在复制技能…',
      nextDisabled: !nodeReady || !pythonReady,
    })}
  </section>`;
}

function connectionStep() {
  const configured = state.data.credential.configured;
  return `<section class="step-panel">
    <header class="step-header">
      <div class="step-kicker">第 2 步 / 共 4 步</div>
      <h2>连接你的 Canvas 账号。</h2>
      <p>使用 Canvas 个人访问令牌。它相当于只供这个技能使用的专用密钥，不需要提供学校密码。</p>
    </header>
    <div class="step-body">
      ${state.installResult ? `<div class="note">${escapeHtml(state.installResult.message)}<br><strong>${escapeHtml(state.installResult.path)}</strong>${state.installResult.backupPath ? `<br>旧版本备份：${escapeHtml(state.installResult.backupPath)}` : ''}</div>` : ''}
      ${configured ? `<div class="note">已检测到保存过的 Canvas Token。你可以继续使用它，也可以输入一个新令牌覆盖。</div>` : ''}
      <div class="guide">
        <div class="guide-item">
          <div class="guide-marker"><span>1</span><i></i></div>
          <div class="guide-content">
            <h3>在 Canvas 创建一个访问令牌</h3>
            <ol>
              <li>用浏览器登录上海交大 Canvas。</li>
              <li>点击头像并进入“设置”。</li>
              <li>找到“已批准的应用”或“访问令牌”，创建新令牌。</li>
              <li>用途填写 sjtu-canvas，复制生成的完整字符串。</li>
            </ol>
            <button class="inline-button" data-action="open-canvas">${icon('external')}打开 Canvas 令牌设置</button>
          </div>
        </div>
        <div class="guide-item">
          <div class="guide-marker"><span>2</span></div>
          <div class="guide-content">
            <h3>粘贴并在线验证</h3>
            <form data-form="token">
              <div class="secret-field">
                <input class="text-input" id="canvas-token" name="token" type="${state.tokenVisible ? 'text' : 'password'}" autocomplete="off" spellcheck="false" placeholder="Canvas Access Token" value="${escapeHtml(state.tokenValue)}" required>
                <button class="reveal" type="button" data-action="toggle-token">${state.tokenVisible ? '隐藏' : '显示'}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      ${state.error ? `<div class="alert" role="alert">${escapeHtml(state.error)}</div>` : ''}
    </div>
    ${footer({
      next: '验证并保存',
      nextAction: 'save-token',
      busyLabel: '正在连接 Canvas…',
      extra: configured ? '<button class="button secondary" data-action="use-existing-token">使用已保存令牌</button>' : '',
    })}
  </section>`;
}

function jobView() {
  const job = state.job;
  if (!job) {
    return `<div class="component-state">
      <div class="component-state-header">
        <div><h3>安装 PPT 与课堂文稿组件</h3><p>需要下载锁定版本的 npm 依赖。基础课程和作业查询不依赖这一步。</p></div>
      </div>
    </div>`;
  }
  const running = job.status === 'running';
  return `<div class="component-state">
    <div class="component-state-header">
      <div><h3>${escapeHtml(job.phase)}</h3><p>${running ? '安装窗口会保持打开，下载完成后自动继续。' : job.status === 'succeeded' ? '高级功能已经准备就绪。' : '可以重试，或先跳过并使用基础查询。'}</p></div>
      ${running ? '<span class="spinner dark" aria-label="正在安装"></span>' : job.status === 'succeeded' ? status('已就绪') : status('未完成', 'bad')}
    </div>
    ${running ? '<div class="progress-track" role="progressbar" aria-label="安装进度"><span></span></div>' : ''}
    ${job.output ? `<pre class="output-log">${escapeHtml(job.output)}</pre>` : ''}
  </div>`;
}

function componentsStep() {
  const ready = state.data.selectedTarget?.dependenciesReady;
  return `<section class="step-panel">
    <header class="step-header">
      <div class="step-kicker">第 3 步 / 共 4 步</div>
      <h2>准备课件、课堂与论文阅读能力。</h2>
      <p>这一步安装浏览器自动化、PDF 阅读和文件处理依赖。如果当前网络较慢，可以先跳过，之后再次打开安装向导即可补装。</p>
    </header>
    <div class="step-body">
      ${ready && !state.job ? `<div class="note">高级组件已检测到并准备就绪。</div>` : jobView()}
      ${state.error ? `<div class="alert" role="alert">${escapeHtml(state.error)}</div>` : ''}
    </div>
    ${footer({
      next: '检查连接',
      nextAction: 'verify',
      busyLabel: '正在启动安装…',
      skip: 'skip-components',
      extra: ready ? '' : `<button class="button secondary" data-action="install-components" ${state.busy || state.job?.status === 'running' ? 'disabled' : ''}>${icon('refresh')}安装组件</button>`,
      nextDisabled: !ready && state.job?.status !== 'succeeded',
    })}
  </section>`;
}

function completeStep() {
  const verified = state.verify;
  return `<section class="step-panel">
    <div class="success-mark">${icon('check')}</div>
    <header class="step-header complete-header">
      <div class="step-kicker">第 4 步 / 共 4 步</div>
      <h2>${verified ? '配置完成，Canvas 已经连上。' : '正在确认课程读取…'}</h2>
      <p>${verified ? '以后不需要再打开终端配置。直接回到 Codex 或其他智能体，用自然语言描述任务即可。' : '安装向导正在验证真实账号和课程列表。'}</p>
    </header>
    <div class="step-body">
      ${state.busy && !verified ? '<div class="loading-state verify-loading"><span class="spinner large"></span><p>正在读取课程列表…</p></div>' : ''}
      ${verified ? `<div class="result-grid">
        <div class="result-item"><span>Canvas 连接</span><strong>在线</strong></div>
        <div class="result-item"><span>当前课程</span><strong>${verified.courseCount} 门可读取</strong></div>
        <div class="result-item"><span>安装位置</span><strong>${escapeHtml(verified.target?.path || state.installResult?.path || '当前目录')}</strong></div>
        <div class="result-item"><span>令牌来源</span><strong>${escapeHtml(verified.credentialSource || 'default-token-file')}</strong></div>
      </div>
      <div class="prompt-box">
        <span>现在可以直接这样说</span>
        <code>用 sjtu-canvas 查看我未来 14 天的作业，并按截止时间排序。</code>
      </div>` : ''}
      ${state.error ? `<div class="alert" role="alert">${escapeHtml(state.error)}</div>` : ''}
    </div>
    <footer class="wizard-footer">
      <div>${verified ? '<button class="button ghost" data-action="close">关闭向导</button>' : ''}</div>
      <div class="footer-actions">
        ${verified ? '' : `<button class="button" data-action="verify" ${state.busy ? 'disabled' : ''}>${state.busy ? '<span class="spinner"></span>正在检查…' : `${icon('refresh')}重新检查`}</button>`}
      </div>
    </footer>
  </section>`;
}

function render() {
  updateProgress();
  versionLabel.textContent = state.data ? `v${state.data.version} · 本地安装` : '正在检查环境';
  if (!state.data) return;
  const mainPanel = document.querySelector('#main-panel');
  if (state.renderedStep !== state.step) {
    mainPanel.scrollTop = 0;
    state.renderedStep = state.step;
  }
  const panel = state.step === 0
    ? environmentStep()
    : state.step === 1
      ? connectionStep()
      : state.step === 2
        ? componentsStep()
        : completeStep();
  wizard.innerHTML = panel;
  wizard.hidden = false;
  loading.hidden = true;
}

async function refreshState() {
  state.data = await api('/api/state');
  if (state.data.credential.configured) state.tokenConnected = true;
  render();
}

async function install() {
  setBusy(true);
  state.error = null;
  try {
    state.installResult = await api('/api/install', {
      platformId: state.platform,
      customPath: state.customPath,
    });
    state.step = 1;
    state.job = null;
    state.verify = null;
    state.busy = false;
    await refreshState();
  } catch (error) {
    state.error = error.message;
    setBusy(false);
  }
}

async function saveToken(token) {
  setBusy(true);
  state.error = null;
  try {
    await api('/api/token', { token });
    state.tokenConnected = true;
    state.tokenValue = '';
    state.step = 2;
    state.job = null;
    state.busy = false;
    await refreshState();
  } catch (error) {
    state.error = error.message;
    setBusy(false);
  }
}

async function useExistingToken() {
  setBusy(true);
  state.error = null;
  try {
    await api('/api/verify', {});
    state.step = 2;
    state.busy = false;
    await refreshState();
  } catch (error) {
    state.error = error.message;
    setBusy(false);
  }
}

async function installComponents() {
  state.error = null;
  setBusy(true);
  try {
    const result = await api('/api/dependencies', {});
    state.job = result.job;
    setBusy(false);
    pollJob();
  } catch (error) {
    state.error = error.message;
    setBusy(false);
  }
}

async function pollJob() {
  if (!state.job || state.job.status !== 'running') return;
  try {
    const result = await api('/api/job');
    state.job = result.job;
    if (state.job?.status === 'running') {
      render();
      setTimeout(pollJob, 900);
    } else {
      await refreshState();
    }
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function verify() {
  state.step = 3;
  setBusy(true);
  state.error = null;
  state.verify = null;
  try {
    state.verify = await api('/api/verify', {});
    setBusy(false);
  } catch (error) {
    state.error = error.message;
    setBusy(false);
  }
}

async function closeWizard() {
  try {
    await api('/api/close', {});
  } finally {
    window.close();
  }
}

wizard.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!event.target.matches('form[data-form="token"]') || state.busy) return;
  const token = new FormData(event.target).get('token');
  if (token) await saveToken(String(token));
});

wizard.addEventListener('change', (event) => {
  if (event.target.name === 'platform') {
    state.platform = event.target.value;
    state.error = null;
    render();
  }
});

wizard.addEventListener('input', (event) => {
  if (event.target.id === 'custom-path') state.customPath = event.target.value;
  if (event.target.id === 'canvas-token') state.tokenValue = event.target.value;
});

wizard.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (button.disabled || state.busy || state.job?.status === 'running') return;
  if (action === 'install') await install();
  else if (action === 'back') {
    if (state.busy) return;
    state.step = Math.max(0, state.step - 1);
    state.error = null;
    render();
  } else if (action === 'toggle-token') {
    state.tokenVisible = !state.tokenVisible;
    render();
  } else if (action === 'open-canvas') {
    await api('/api/open-canvas', {}).catch(() => {});
  } else if (action === 'save-token') {
    if (!state.tokenValue.trim()) {
      state.error = '请先粘贴 Canvas Token。';
      render();
      return;
    }
    await saveToken(state.tokenValue);
  } else if (action === 'use-existing-token') {
    await useExistingToken();
  } else if (action === 'install-components') {
    await installComponents();
  } else if (action === 'skip-components') {
    await verify();
  } else if (action === 'verify') {
    await verify();
  } else if (action === 'close') {
    await closeWizard();
  }
});

refreshState().catch((error) => {
  loading.innerHTML = `<div class="alert" role="alert">${escapeHtml(error.message)}</div>`;
});
