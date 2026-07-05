// ==UserScript==
// @name         划词AI搜索
// @namespace    https://local/selection-ai-search
// @version      1.0.0
// @description  选中页面文字后按快捷键，弹出小窗口用配置的AI进行搜索/解释，不离开当前页面
// @author       you
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'sas_config_v1';

  const DEFAULT_CONFIG = {
    hotkey: 'alt+q', // 触发快捷键
    style: 'rich', // rich | concise | answerOnly
    activeProviderId: 'deepseek',
    providers: [
      {
        id: 'deepseek',
        name: 'DeepSeek 官方',
        baseURL: 'https://api.deepseek.com/chat/completions',
        apiKey: '',
        model: 'deepseek-chat',
        type: 'openai' // openai 兼容协议
      },
      {
        id: 'claude',
        name: 'Claude 官方',
        baseURL: 'https://api.anthropic.com/v1/messages',
        apiKey: '',
        model: 'claude-sonnet-5',
        type: 'anthropic'
      },
      {
        id: 'openai',
        name: 'OpenAI 官方',
        baseURL: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        model: 'gpt-4o-mini',
        type: 'openai'
      },
      {
        id: 'custom',
        name: '自定义中转站',
        baseURL: '',
        apiKey: '',
        model: '',
        type: 'openai'
      }
    ]
  };

  function loadConfig() {
    const saved = GM_getValue(STORAGE_KEY, null);
    if (!saved) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    try {
      const cfg = JSON.parse(saved);
      // merge in case new fields added later
      return Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), cfg);
    } catch (e) {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  function saveConfig(cfg) {
    GM_setValue(STORAGE_KEY, JSON.stringify(cfg));
  }

  let config = loadConfig();

  // ---------- Shadow DOM 容器：隔离宿主页面样式，避免不同网站的全局 CSS 污染我们的 UI ----------
  const shadowHost = document.createElement('div');
  shadowHost.style.all = 'initial';
  document.documentElement.appendChild(shadowHost);
  const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  // ---------- 样式 ----------
  const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .sas-popup, .sas-settings-mask {
      all: initial;
      font-family: ${FONT_STACK};
      color-scheme: dark;
    }
    .sas-popup *, .sas-settings-mask * {
      box-sizing: border-box;
      font-family: ${FONT_STACK};
    }
    .sas-popup {
      position: fixed;
      z-index: 2147483647;
      width: 440px;
      max-width: 92vw;
      max-height: 70vh;
      background: #1c1c1e;
      color: #e8e8ea;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.03);
      font-size: 13px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sas-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: linear-gradient(180deg, #2a2a2d, #242426);
      cursor: move;
      user-select: none;
      border-bottom: 1px solid rgba(255,255,255,.06);
      gap: 8px;
    }
    .sas-header .sas-title { font-weight: 600; letter-spacing: .2px; white-space: nowrap; }
    .sas-header-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    .sas-select {
      background: #2f2f33; color: #e8e8ea; border: 1px solid rgba(255,255,255,.1);
      border-radius: 6px; font-size: 12px; padding: 4px 6px; outline: none;
      appearance: none; -webkit-appearance: none;
      background-image: linear-gradient(45deg, transparent 50%, #9aa0a6 50%), linear-gradient(135deg, #9aa0a6 50%, transparent 50%);
      background-position: calc(100% - 12px) center, calc(100% - 7px) center;
      background-size: 5px 5px, 5px 5px;
      background-repeat: no-repeat;
      padding-right: 22px;
      max-width: 150px;
    }
    .sas-select:focus { border-color: #5b8def; }
    .sas-btn {
      cursor: pointer; border: 1px solid rgba(255,255,255,.1); background: #33333a; color: #eee;
      border-radius: 6px; padding: 4px 9px; font-size: 12px; line-height: 1.4;
      transition: background .12s ease;
    }
    .sas-btn:hover { background: #414148; }
    .sas-btn:active { background: #3a3a40; }
    .sas-btn-primary { background: #2d6cdf; border-color: #2d6cdf; }
    .sas-btn-primary:hover { background: #3a78ea; }
    .sas-query {
      padding: 8px 12px; font-size: 12px; color: #9aa0a6;
      border-bottom: 1px solid rgba(255,255,255,.06); max-height: 80px; overflow: auto; white-space: pre-wrap;
    }
    .sas-body {
      padding: 12px; overflow: auto; flex: 1; line-height: 1.65; white-space: pre-wrap;
    }
    .sas-body code { background: #2d2d31; padding: 1px 5px; border-radius: 4px; }
    .sas-footer {
      padding: 8px 12px; border-top: 1px solid rgba(255,255,255,.06); display: flex; gap: 6px; justify-content: flex-end;
    }
    .sas-loading { color: #9aa0a6; }
    .sas-error { color: #ff7a7a; white-space: pre-wrap; }

    .sas-settings-mask {
      position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(2px);
    }
    .sas-settings {
      width: 540px; max-width: 94vw; max-height: 88vh; overflow: auto;
      background: #1c1c1e; color: #eee; border-radius: 14px; padding: 22px 24px;
      font-size: 13px;
      border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 20px 60px rgba(0,0,0,.6);
    }
    .sas-settings::-webkit-scrollbar { width: 8px; }
    .sas-settings::-webkit-scrollbar-thumb { background: #3a3a3f; border-radius: 4px; }
    .sas-settings h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
    .sas-settings .sas-subtitle { margin: 0 0 18px; font-size: 12px; color: #8b8b90; }
    .sas-settings h3 {
      margin: 22px 0 10px; font-size: 12px; font-weight: 600; letter-spacing: .4px;
      color: #8b8b90; text-transform: uppercase;
    }
    .sas-settings h3:first-of-type { margin-top: 0; }
    .sas-hint { color: #75757a; font-size: 11px; margin: -6px 0 10px 128px; }
    .sas-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .sas-row label { width: 118px; flex-shrink: 0; color: #b7b7bc; font-size: 12.5px; }
    .sas-row input[type="text"], .sas-row input[type="password"], .sas-row select {
      flex: 1; background: #2a2a2e; color: #f0f0f2; border: 1px solid rgba(255,255,255,.1);
      border-radius: 7px; padding: 8px 10px; font-size: 12.5px;
      outline: none; transition: border-color .12s ease, background .12s ease;
    }
    .sas-row input[type="text"]::placeholder, .sas-row input[type="password"]::placeholder { color: #6b6b70; }
    .sas-row input[type="text"]:hover, .sas-row input[type="password"]:hover, .sas-row select:hover { border-color: rgba(255,255,255,.18); }
    .sas-row input[type="text"]:focus, .sas-row input[type="password"]:focus, .sas-row select:focus {
      border-color: #5b8def; background: #2f2f34; box-shadow: 0 0 0 3px rgba(91,141,239,.18);
    }
    .sas-row select {
      appearance: none; -webkit-appearance: none;
      background-image: linear-gradient(45deg, transparent 50%, #9aa0a6 50%), linear-gradient(135deg, #9aa0a6 50%, transparent 50%);
      background-position: calc(100% - 16px) center, calc(100% - 11px) center;
      background-size: 5px 5px, 5px 5px;
      background-repeat: no-repeat;
    }
    .sas-provider-block {
      border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 14px; margin-bottom: 12px; background: #222224;
    }
    .sas-provider-block .sas-row label { width: 84px; }
    .sas-settings-actions {
      display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px;
      padding-top: 16px; border-top: 1px solid rgba(255,255,255,.06);
    }
    .sas-settings-actions .sas-btn { padding: 7px 16px; }
    .sas-radio-group { display: flex; gap: 16px; flex: 1; }
    .sas-radio-group label {
      width: auto; display: flex; align-items: center; gap: 5px; color: #ccc; cursor: pointer; font-size: 12.5px;
    }
    .sas-radio-group input[type="radio"] { accent-color: #5b8def; width: 14px; height: 14px; cursor: pointer; }
  `;
  shadowRoot.appendChild(style);

  // ---------- 快捷键解析 ----------
  function normalizeHotkey(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('meta');
    const key = e.key.toLowerCase();
    if (!['control', 'alt', 'shift', 'meta'].includes(key)) parts.push(key);
    return parts.join('+');
  }

  let lastSelectionText = '';

  function captureSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (text) lastSelectionText = text;
  }

  // 部分站点（如 Gemini 等富文本/自定义编辑器）鼠标事件被内部逻辑吞掉，
  // 用 selectionchange 兜底，只要浏览器认为选区变化了就记录一次
  document.addEventListener('selectionchange', captureSelection, true);
  document.addEventListener('mouseup', captureSelection, true);
  document.addEventListener('keyup', captureSelection, true);

  // 挂在 window 的捕获阶段，比大多数站点自己挂在 document 上的快捷键拦截更早触发，
  // 尽量避免被站点自身的全局快捷键逻辑吞掉
  window.addEventListener('keydown', (e) => {
    const combo = normalizeHotkey(e);
    if (combo === config.hotkey.toLowerCase() && lastSelectionText) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      openSearchPopup(lastSelectionText);
    }
  }, true);

  GM_registerMenuCommand('划词AI搜索 - 设置', openSettings);

  // ---------- 弹窗 ----------
  let currentPopup = null;
  let currentAbort = null;

  function closePopup() {
    if (currentPopup) {
      currentPopup.remove();
      currentPopup = null;
    }
    if (currentAbort) {
      currentAbort();
      currentAbort = null;
    }
  }

  function makeDraggable(popup, handle) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('select, button')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const rect = popup.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      popup.style.left = (ox + e.clientX - sx) + 'px';
      popup.style.top = (oy + e.clientY - sy) + 'px';
      popup.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  function buildPrompt(text, style) {
    if (style === 'answerOnly') {
      return `请仅给出问题/内容的直接答案，不要任何解释、不要客套话、不要多余文字：\n\n${text}`;
    }
    if (style === 'concise') {
      return `请用简短的语言（尽量控制在3句话以内）解释或回答以下内容：\n\n${text}`;
    }
    return `请详细、丰富地解释或回答以下内容，可以包含背景、要点和示例：\n\n${text}`;
  }

  function openSearchPopup(text) {
    closePopup();

    const popup = document.createElement('div');
    popup.className = 'sas-popup';
    popup.style.top = '80px';
    popup.style.right = '40px';

    const providerOptions = config.providers
      .map(p => `<option value="${p.id}" ${p.id === config.activeProviderId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
      .join('');

    popup.innerHTML = `
      <div class="sas-header">
        <span class="sas-title">AI 搜索</span>
        <div class="sas-header-actions">
          <select class="sas-select sas-provider-select">${providerOptions}</select>
          <select class="sas-select sas-style-select">
            <option value="rich" ${config.style === 'rich' ? 'selected' : ''}>丰富</option>
            <option value="concise" ${config.style === 'concise' ? 'selected' : ''}>简短</option>
            <option value="answerOnly" ${config.style === 'answerOnly' ? 'selected' : ''}>仅答案</option>
          </select>
          <button class="sas-btn sas-settings-btn" title="设置">⚙</button>
          <button class="sas-btn sas-close-btn" title="关闭">✕</button>
        </div>
      </div>
      <div class="sas-query"></div>
      <div class="sas-body"><span class="sas-loading">正在请求 AI…</span></div>
      <div class="sas-footer">
        <button class="sas-btn sas-retry-btn">重试</button>
        <button class="sas-btn sas-copy-btn">复制结果</button>
      </div>
    `;

    shadowRoot.appendChild(popup);
    currentPopup = popup;

    popup.querySelector('.sas-query').textContent = text;
    makeDraggable(popup, popup.querySelector('.sas-header'));

    popup.querySelector('.sas-close-btn').addEventListener('click', closePopup);
    popup.querySelector('.sas-settings-btn').addEventListener('click', openSettings);

    popup.querySelector('.sas-provider-select').addEventListener('change', (e) => {
      config.activeProviderId = e.target.value;
      saveConfig(config);
      runQuery(text, popup);
    });

    popup.querySelector('.sas-style-select').addEventListener('change', (e) => {
      config.style = e.target.value;
      saveConfig(config);
      runQuery(text, popup);
    });

    popup.querySelector('.sas-retry-btn').addEventListener('click', () => runQuery(text, popup));
    popup.querySelector('.sas-copy-btn').addEventListener('click', () => {
      const body = popup.querySelector('.sas-body');
      GM_setClipboard ? GM_setClipboard(body.innerText) : navigator.clipboard.writeText(body.innerText);
    });

    document.addEventListener('keydown', escListener);

    runQuery(text, popup);
  }

  function escListener(e) {
    if (e.key === 'Escape' && currentPopup) {
      closePopup();
      document.removeEventListener('keydown', escListener);
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getActiveProvider() {
    return config.providers.find(p => p.id === config.activeProviderId) || config.providers[0];
  }

  function runQuery(text, popup) {
    if (currentAbort) { currentAbort(); currentAbort = null; }

    const body = popup.querySelector('.sas-body');
    body.innerHTML = '<span class="sas-loading">正在请求 AI…</span>';

    const provider = getActiveProvider();
    if (!provider || !provider.baseURL || !provider.apiKey) {
      body.innerHTML = `<div class="sas-error">当前 AI 提供方未配置完整（baseURL / apiKey）。请点击右上角 ⚙ 进行设置。</div>`;
      return;
    }

    const prompt = buildPrompt(text, config.style);

    let streamed = '';
    let started = false;

    const { request, abort } = sendChatRequest(provider, prompt, (delta) => {
      if (!delta) return;
      if (!started) { started = true; body.textContent = ''; }
      streamed += delta;
      body.textContent = streamed;
    });
    currentAbort = abort;

    request
      .then((answer) => {
        body.textContent = answer || streamed;
      })
      .catch((err) => {
        body.innerHTML = `<div class="sas-error">请求失败：${escapeHtml(String(err && err.message || err))}</div>`;
      });
  }

  // 解析累积的 SSE 缓冲区，返回本次新增文本，并推进 state.pos
  function parseSSEChunk(fullText, state, providerType) {
    let out = '';
    const newPart = fullText.slice(state.pos);
    state.pos = fullText.length;
    state.buffer += newPart;

    const lines = state.buffer.split('\n');
    state.buffer = lines.pop(); // 最后一行可能不完整，留到下次

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;
      let evt;
      try {
        evt = JSON.parse(dataStr);
      } catch (e) {
        continue;
      }
      if (providerType === 'anthropic') {
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          out += evt.delta.text;
        }
      } else {
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) out += delta;
      }
    }
    return out;
  }

  function sendChatRequest(provider, prompt, onChunk) {
    let xhr = null;
    const abort = () => { if (xhr) xhr.abort(); };

    let url = provider.baseURL;
    let headers = { 'Content-Type': 'application/json' };
    let payload;

    if (provider.type === 'anthropic') {
      headers['x-api-key'] = provider.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      payload = {
        model: provider.model,
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'user', content: prompt }]
      };
    } else {
      headers['Authorization'] = `Bearer ${provider.apiKey}`;
      payload = {
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      };
    }

    const sseState = { pos: 0, buffer: '' };
    let fullAnswer = '';
    let gotAnyChunk = false;

    const request = new Promise((resolve, reject) => {
      xhr = GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers,
        data: JSON.stringify(payload),
        timeout: 60000,
        onprogress: (res) => {
          if (res.responseText === undefined || res.responseText === null) return;
          const delta = parseSSEChunk(res.responseText, sseState, provider.type);
          if (delta) {
            gotAnyChunk = true;
            fullAnswer += delta;
            onChunk(delta);
          }
        },
        onload: (res) => {
          const raw = res.responseText;

          if (raw === undefined || raw === null || raw === '') {
            reject(new Error(
              `未收到响应内容 (HTTP ${res.status || '?'})。` +
              `请检查：1) 接口地址是否正确 2) API Key 是否有效 3) 是否被目标网站 CORS/风控拦截。` +
              (res.finalUrl ? ` 实际请求地址: ${res.finalUrl}` : '')
            ));
            return;
          }

          // 补吃 onprogress 可能遗漏的最后一段（含未触发 onprogress 的情况）
          const tail = parseSSEChunk(raw, sseState, provider.type);
          if (tail) {
            gotAnyChunk = true;
            fullAnswer += tail;
            onChunk(tail);
          }

          if (gotAnyChunk) {
            resolve(fullAnswer);
            return;
          }

          // 走到这里说明响应根本不是 SSE 格式，按普通 JSON 响应兜底解析
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (e) {
            reject(new Error(`响应不是合法 JSON 也不是 SSE 流 (HTTP ${res.status})：${raw.slice(0, 300)}`));
            return;
          }

          if (res.status < 200 || res.status >= 300) {
            const msg = (json && (json.error?.message || json.message)) || raw.slice(0, 300) || `HTTP ${res.status}`;
            reject(new Error(msg));
            return;
          }

          try {
            let answer;
            if (provider.type === 'anthropic') {
              answer = (json.content && json.content.map(c => c.text).join('\n')) || JSON.stringify(json);
            } else {
              answer = json.choices?.[0]?.message?.content || JSON.stringify(json);
            }
            resolve(answer);
          } catch (e) {
            reject(new Error('返回内容格式不符合预期: ' + JSON.stringify(json).slice(0, 300)));
          }
        },
        onerror: (res) => reject(new Error(
          `网络请求失败，请检查 baseURL / 网络 / CORS 设置` +
          (res && res.finalUrl ? `（请求地址: ${res.finalUrl}）` : '')
        )),
        ontimeout: () => reject(new Error('请求超时')),
        onabort: () => {}
      });
    });

    return { request, abort };
  }

  // ---------- 设置面板 ----------
  function openSettings() {
    const mask = document.createElement('div');
    mask.className = 'sas-settings-mask';

    const providersHtml = config.providers.map((p, idx) => `
      <div class="sas-provider-block" data-idx="${idx}">
        <div class="sas-row">
          <label>名称</label>
          <input type="text" data-field="name" value="${escapeHtml(p.name)}">
        </div>
        <div class="sas-row">
          <label>协议类型</label>
          <select data-field="type">
            <option value="openai" ${p.type === 'openai' ? 'selected' : ''}>OpenAI 兼容 (DeepSeek/OpenAI/中转站)</option>
            <option value="anthropic" ${p.type === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
          </select>
        </div>
        <div class="sas-row">
          <label>接口地址</label>
          <input type="text" data-field="baseURL" placeholder="https://api.xxx.com/v1/chat/completions" value="${escapeHtml(p.baseURL)}">
        </div>
        <div class="sas-row">
          <label>API Key</label>
          <input type="password" data-field="apiKey" value="${escapeHtml(p.apiKey)}">
        </div>
        <div class="sas-row">
          <label>模型名</label>
          <input type="text" data-field="model" value="${escapeHtml(p.model)}">
        </div>
      </div>
    `).join('');

    mask.innerHTML = `
      <div class="sas-settings">
        <h2>划词AI搜索 - 设置</h2>
        <p class="sas-subtitle">配置快捷键、回复风格与 AI 提供方</p>

        <h3>快捷键</h3>
        <div class="sas-row">
          <label>触发快捷键</label>
          <input type="text" id="sas-hotkey-input" value="${escapeHtml(config.hotkey)}" placeholder="例如 alt+q">
        </div>
        <div class="sas-hint">先点击此输入框，再按下想要的组合键（会自动捕获）</div>

        <h3>回复风格默认值</h3>
        <div class="sas-row">
          <label>风格</label>
          <div class="sas-radio-group">
            <label><input type="radio" name="sas-style" value="rich" ${config.style === 'rich' ? 'checked' : ''}> 丰富</label>
            <label><input type="radio" name="sas-style" value="concise" ${config.style === 'concise' ? 'checked' : ''}> 简短</label>
            <label><input type="radio" name="sas-style" value="answerOnly" ${config.style === 'answerOnly' ? 'checked' : ''}> 仅答案</label>
          </div>
        </div>

        <h3>默认使用的 AI</h3>
        <div class="sas-row">
          <label>提供方</label>
          <select id="sas-active-provider">
            ${config.providers.map(p => `<option value="${p.id}" ${p.id === config.activeProviderId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>

        <h3>AI 提供方配置</h3>
        <div id="sas-providers-container">${providersHtml}</div>

        <div class="sas-settings-actions">
          <button class="sas-btn" id="sas-cancel-btn">取消</button>
          <button class="sas-btn sas-btn-primary" id="sas-save-btn">保存</button>
        </div>
      </div>
    `;

    shadowRoot.appendChild(mask);

    const hotkeyInput = mask.querySelector('#sas-hotkey-input');
    hotkeyInput.addEventListener('keydown', (e) => {
      e.preventDefault();
      hotkeyInput.value = normalizeHotkey(e);
    });

    mask.querySelector('#sas-cancel-btn').addEventListener('click', () => mask.remove());
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });

    mask.querySelector('#sas-save-btn').addEventListener('click', () => {
      config.hotkey = hotkeyInput.value.trim() || config.hotkey;
      config.style = mask.querySelector('input[name="sas-style"]:checked').value;
      config.activeProviderId = mask.querySelector('#sas-active-provider').value;

      mask.querySelectorAll('.sas-provider-block').forEach((block) => {
        const idx = Number(block.dataset.idx);
        const p = config.providers[idx];
        p.name = block.querySelector('[data-field="name"]').value.trim();
        p.type = block.querySelector('[data-field="type"]').value;
        p.baseURL = block.querySelector('[data-field="baseURL"]').value.trim();
        p.apiKey = block.querySelector('[data-field="apiKey"]').value.trim();
        p.model = block.querySelector('[data-field="model"]').value.trim();
      });

      saveConfig(config);
      mask.remove();
    });
  }
})();
