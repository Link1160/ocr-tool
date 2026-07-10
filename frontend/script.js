// ============================================================
// 配置（集中管理，可扩展）
// ============================================================
const CONFIG = {
  API_BASE: window.API_BASE || 'http://127.0.0.1:5000',
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  POLL_INTERVAL_INITIAL: 1000,      // 初始轮询间隔（ms）
  POLL_INTERVAL_MAX: 5000,           // 最大轮询间隔（ms）
  POLL_MAX_DURATION: 120000,         // 轮询总超时（ms）
  UPLOAD_TIMEOUT: 30000,             // 上传超时（ms）
  HISTORY_CACHE_TTL: 60000,          // 全量历史缓存有效期（ms）
};

// ============================================================
// 全局状态（封装）
// ============================================================
const appState = {
  taskId: null,
  pollingTimer: null,          // 当前轮询的 setTimeout id
  boxImgUrl: "",
  pollingActive: false,
  abortCtrl: null,             // 用于轮询请求
  historyAbortCtrl: null,      // 用于历史/搜索请求
  fullHistoryCache: { data: null, timestamp: 0 },

  // 重置轮询
  resetPolling() {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.pollingActive = false;
    if (this.abortCtrl) {
      this.abortCtrl.abort();
      this.abortCtrl = null;
    }
    hidePersistentMessage();
  },

  // 取消历史请求
  cancelHistoryRequest() {
    if (this.historyAbortCtrl) {
      this.historyAbortCtrl.abort();
      this.historyAbortCtrl = null;
    }
  },

  // 完全重置
  fullReset() {
    this.resetPolling();
    this.taskId = null;
    this.boxImgUrl = "";
  }
};

// ============================================================
// DOM 缓存
// ============================================================
const $ = (id) => document.getElementById(id);
const dom = {
  dropZone: $('dropZone'),
  fileInput: $('fileInput'),
  resultText: $('resultText'),
  resultActions: $('resultActions'),
  previewWrap: $('box-preview-wrap'),
  previewImg: $('box-preview-img'),
  previewEmpty: $('preview-empty'),
  historyList: $('historyList'),
  historySidebar: $('historySidebar'),
  historyInput: $('historyInput'),
  copyBtn: $('copyBtn'),
  saveBtn: $('saveBtn'),
  clearPreviewBtn: $('btn-clear-preview'),
  clearResultBtn: $('btn-clear-result'),
  clearHistoryBtn: $('btn-clear-history'),
  historyBtn: $('historyBtn'),
  searchBtn: $('searchBtn'),
  messageContainer: $('messageContainer'),
  loadingOverlay: $('loadingOverlay'),
};

// ============================================================
// 工具函数
// ============================================================
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function setLoadingState(loading) {
  if (dom.dropZone) {
    dom.dropZone.style.opacity = loading ? "0.6" : "1";
    dom.dropZone.style.cursor = loading ? "wait" : "pointer";
  }
  if (dom.loadingOverlay) {
    dom.loadingOverlay.style.display = loading ? "flex" : "none";
  }
}

// ----- 临时消息 -----
function showMessage(msg, type = 'info') {
  const container = dom.messageContainer;
  if (!container) return console.log(`[${type}] ${msg}`);
  const existing = container.querySelectorAll(`.message.${type}`);
  existing.forEach(el => el.remove());
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.textContent = msg;
  container.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ----- 持久消息 -----
let persistentMessageEl = null;

function showPersistentMessage(msg, type = 'info') {
  hidePersistentMessage();
  const container = dom.messageContainer;
  if (!container) return;
  const div = document.createElement('div');
  div.className = `message ${type} persistent`;
  div.textContent = msg;
  container.appendChild(div);
  persistentMessageEl = div;
}

function hidePersistentMessage() {
  if (persistentMessageEl) {
    persistentMessageEl.remove();
    persistentMessageEl = null;
  }
}

// ----- 统一错误处理（细化错误信息）-----
function handleError(err, context = '操作', shouldStopPolling = false) {
  if (err.name === 'AbortError') return;
  let msg = err.message || '未知错误';
  // 细化网络错误
  if (err.name === 'TypeError' || err.message.includes('fetch')) {
    msg = '网络连接异常，请检查网络后重试';
  } else if (err.name === 'TimeoutError') {
    msg = '请求超时，请稍后重试';
  } else if (err.status) {
    // 如果错误对象带有 status 属性，拼接状态码
    msg = `服务器响应异常 (${err.status}) ${err.statusText || ''}`.trim();
  }
  showMessage(`${context}失败：${msg}`, 'error');
  if (shouldStopPolling) {
    appState.resetPolling();
    setLoadingState(false);
  }
}

// ============================================================
// 核心功能
// ============================================================

// ----- 公共上传方法（带超时）-----
async function uploadImageFile(file) {
  const formData = new FormData();
  formData.append('image', file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    // 抛出超时错误
    const error = new Error('上传超时');
    error.name = 'TimeoutError';
    throw error;
  }, CONFIG.UPLOAD_TIMEOUT);

  try {
    const res = await fetch(`${CONFIG.API_BASE}/upload`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.statusText = res.statusText;
      throw err;
    }
    const resp = await res.json();
    if (!resp || resp.code !== 200 || !resp.task_id) {
      throw new Error(resp?.msg || "上传失败或未获取任务ID");
    }
    return resp.task_id;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ----- 清除预览 -----
function clearAllPreview() {
  dom.previewWrap.hidden = true;
  dom.previewImg.src = "";
  dom.previewEmpty.style.display = "block";
  appState.boxImgUrl = "";
  appState.taskId = null;
  appState.resetPolling();
}

// ----- 文件上传处理 -----
async function handleFileUpload(file) {
  // 增强文件类型校验
  const allowMime = ['image/jpeg','image/png','image/gif','image/webp','image/bmp'];
  const allowExt = ['jpg','jpeg','png','gif','webp','bmp'];
  const fileName = file.name.toLowerCase();
  const fileExt = fileName.split('.').pop();
  const isMimeOk = allowMime.includes(file.type);
  const isExtOk = allowExt.includes(fileExt);
  // 兼容：如果 type 为空，仅靠扩展名；否则两者需其一
  const isImage = (file.type === '' && isExtOk) || (isMimeOk || isExtOk);

  if (!isImage) {
    showMessage('当前不支持该文件类型，请上传jpg/png/gif/webp/bmp图片', 'error');
    return;
  }
  if (file.size > CONFIG.MAX_FILE_SIZE) {
    showMessage(`文件过大（超过 ${CONFIG.MAX_FILE_SIZE/1024/1024}MB），请压缩后重试`, 'error');
    return;
  }

  showMessage('正在上传图片...', 'info');
  setLoadingState(true);

  try {
    const taskId = await uploadImageFile(file);
    showMessage('上传成功，开始识别...', 'success');
    appState.taskId = taskId;
    startPolling(taskId);
  } catch (err) {
    handleError(err, '上传', true);
  }
}

// ----- 历史记录重新识别（保持不变，但复用上传超时）-----
async function reRecognizeByHistoryImgUrl(imgUrl) {
  showMessage("正在重新加载图片...", "info");
  setLoadingState(true);
  try {
    const res = await fetch(imgUrl, { mode: 'cors' });
    if (!res.ok) throw new Error(`获取历史图片失败 (HTTP ${res.status})`);
    const blob = await res.blob();
    const ext = imgUrl.split('.').pop().split('?')[0] || 'jpg';
    const file = new File([blob], `history_temp.${ext}`, { type: blob.type || 'image/jpeg' });
    const taskId = await uploadImageFile(file);
    showMessage('重新识别已开始', 'success');
    appState.taskId = taskId;
    startPolling(taskId);
  } catch (err) {
    handleError(err, '重新识别', true);
  }
}

// ----- 轮询（使用 setTimeout 链 + 指数退避）-----
function startPolling(taskId) {
  appState.resetPolling();
  appState.pollingActive = true;
  appState.taskId = taskId;
  showPersistentMessage('正在识别图片...', 'info');

  const startTime = Date.now();
  let currentInterval = CONFIG.POLL_INTERVAL_INITIAL;

  // 取消之前的 AbortController
  if (appState.abortCtrl) {
    appState.abortCtrl.abort();
  }
  appState.abortCtrl = new AbortController();

  // 定义轮询任务（递归）
  const pollTask = async () => {
    // 检查是否仍处于活动状态
    if (!appState.pollingActive || appState.taskId !== taskId) {
      appState.resetPolling();
      return;
    }

    // 检查总耗时是否超时
    if (Date.now() - startTime > CONFIG.POLL_MAX_DURATION) {
      appState.resetPolling();
      setLoadingState(false);
      showMessage('识别超时，请重新上传图片', 'error');
      return;
    }

    // 发起请求
    try {
      const res = await fetch(`${CONFIG.API_BASE}/status/${taskId}`, {
        signal: appState.abortCtrl.signal,
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.statusText = res.statusText;
        throw err;
      }
      const resp = await res.json();

      // 再次检查状态（可能在请求期间被重置）
      if (!appState.pollingActive || appState.taskId !== taskId) return;

      if (!resp || resp.code !== 200) {
        throw new Error(resp?.msg || "查询任务状态失败");
      }

      const data = resp.data;
      if (data.status === "done") {
        // 任务完成
        appState.resetPolling();
        setLoadingState(false);
        displayResult(data.result || '', taskId);
        if (data.box_img_url) {
          appState.boxImgUrl = data.box_img_url;
          dom.previewWrap.hidden = false;
          dom.previewImg.src = appState.boxImgUrl;
          dom.previewEmpty.style.display = "none";
        }
        showMessage('识别完成！', 'success');
        // 刷新历史缓存
        appState.fullHistoryCache.data = null;
        appState.fullHistoryCache.timestamp = 0;
        loadHistoryDebounced();
        return;
      } else if (data.status === 'pending' || data.status === 'doing') {
        // 继续轮询，更新持久消息（显示已等待秒数）
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        showPersistentMessage(`正在识别图片... (${elapsed}s)`, 'info');
        // 计算下次间隔（指数退避，不超过最大值）
        currentInterval = Math.min(currentInterval * 1.5, CONFIG.POLL_INTERVAL_MAX);
        // 设置下一次轮询
        appState.pollingTimer = setTimeout(pollTask, currentInterval);
      } else {
        // 其他状态视为失败
        appState.resetPolling();
        setLoadingState(false);
        showMessage(`识别失败: ${data.error || "未知错误"}`, 'error');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      // 网络错误等
      if (!appState.pollingActive || appState.taskId !== taskId) return;
      // 错误处理：停止轮询并提示，但可选重试？这里保持原逻辑，直接停止
      appState.resetPolling();
      setLoadingState(false);
      handleError(err, '查询任务状态', false);
    }
  };

  // 开始第一次轮询（延迟一个间隔）
  appState.pollingTimer = setTimeout(pollTask, CONFIG.POLL_INTERVAL_INITIAL);
}

// ----- 显示结果 -----
function displayResult(text, taskId) {
  dom.resultText.value = text || '';
  dom.resultActions.style.display = 'flex';
  dom.copyBtn.dataset.text = text || '';
  dom.saveBtn.dataset.taskId = taskId || '';
}

// ============================================================
// 按钮功能
// ============================================================

function initCopyButton() {
  dom.copyBtn?.addEventListener('click', function() {
    const text = this.dataset.text || '';
    if (!text) {
      showMessage('暂无内容可复制', 'warning');
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      showMessage('复制成功', 'success');
    }).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      showMessage('复制成功', 'success');
      document.body.removeChild(textarea);
    });
  });
}

function initSaveButton() {
  dom.saveBtn?.addEventListener('click', async function() {
    const taskId = this.dataset.taskId || appState.taskId;
    if (!taskId) {
      showMessage('无识别任务，无法导出', 'warning');
      return;
    }
    try {
      const res = await fetch(`${CONFIG.API_BASE}/export/${taskId}`);
      if (!res.ok) throw new Error(`导出失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `ocr_result_${taskId}.txt`;
      document.body.appendChild(link);
      link.click();
      URL.revokeObjectURL(link.href);
      document.body.removeChild(link);
      showMessage('文件已下载', 'success');
    } catch (err) {
      handleError(err, '导出', false);
    }
  });
}

function initClearPreviewBtn() {
  dom.clearPreviewBtn?.addEventListener("click", clearAllPreview);
}

function initClearResultBtn() {
  dom.clearResultBtn?.addEventListener("click", () => {
    dom.resultText.value = "";
    dom.resultActions.style.display = "none";
    appState.taskId = null;
  });
}

function initClearHistoryBtn() {
  dom.clearHistoryBtn?.addEventListener("click", async () => {
    if (!confirm("确定永久清空全部识别历史？此操作不可撤销")) return;
    try {
      const res = await fetch(`${CONFIG.API_BASE}/clear_history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const resp = await res.json();
      if (resp.code === 200) {
        showMessage("历史已全部清空", "success");
        dom.historyList.innerHTML = '<li class="history-list__empty">暂无历史记录</li>';
        appState.fullHistoryCache.data = null;
        appState.fullHistoryCache.timestamp = 0;
      } else {
        showMessage(`清空失败：${resp.message || "服务器异常"}`, "error");
      }
    } catch (err) {
      handleError(err, '清空历史', false);
    }
  });
}

// ============================================================
// 拖拽 / 文件选择
// ============================================================
function initUploadArea() {
  const dropZone = dom.dropZone;
  if (!dropZone) return;
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileUpload(files[0]);
  });
}

function initFileInput() {
  dom.fileInput?.addEventListener('change', e => {
    const files = e.target.files;
    if (files.length > 0) handleFileUpload(files[0]);
    dom.fileInput.value = '';
  });
}

// ============================================================
// 历史记录管理
// ============================================================

const loadHistoryDebounced = debounce(loadHistory, 300);

async function loadHistory() {
  const historyList = dom.historyList;
  if (!historyList) return;

  const now = Date.now();
  if (appState.fullHistoryCache.data && (now - appState.fullHistoryCache.timestamp) < CONFIG.HISTORY_CACHE_TTL) {
    renderHistoryList(appState.fullHistoryCache.data, historyList);
    return;
  }

  appState.cancelHistoryRequest();
  appState.historyAbortCtrl = new AbortController();

  try {
    const res = await fetch(`${CONFIG.API_BASE}/history?t=${now}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: appState.historyAbortCtrl.signal
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.statusText = res.statusText;
      throw err;
    }
    const resp = await res.json();
    const listData = resp.data ?? [];
    appState.fullHistoryCache.data = listData;
    appState.fullHistoryCache.timestamp = now;
    renderHistoryList(listData, historyList);
  } catch (err) {
    if (err.name === 'AbortError') return;
    handleError(err, '加载历史', false);
  } finally {
    appState.historyAbortCtrl = null;
  }
}

function renderHistoryList(items, container) {
  container.innerHTML = '';
  if (!items || !Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<li class="history-list__empty">暂无历史记录</li>';
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const timeSpan = document.createElement('time');
    timeSpan.className = 'history-item__time';
    timeSpan.textContent = new Date(item.timestamp * 1000).toLocaleString();

    const textSpan = document.createElement('span');
    textSpan.className = 'history-item__title';
    const rawText = item.ocr_text || '';
    textSpan.textContent = rawText.length > 60 ? rawText.slice(0, 60) + '...' : rawText;

    const btn = document.createElement('button');
    btn.className = 'history-item__btn';
    btn.appendChild(timeSpan);
    btn.appendChild(document.createElement('br'));
    btn.appendChild(textSpan);

    btn.addEventListener('click', () => {
      if (!item.image_file_path) {
        showMessage("该历史无原图地址，无法重新识别", "warning");
        return;
      }
      clearAllPreview();
      reRecognizeByHistoryImgUrl(item.image_file_path);
    });

    li.appendChild(btn);
    fragment.appendChild(li);
  });
  container.appendChild(fragment);
}

// ----- 打开侧边栏时的智能加载（根据搜索框内容）-----
function initHistoryButton() {
  dom.historyBtn?.addEventListener('click', function() {
    const isOpen = dom.historySidebar?.classList.toggle('open');
    if (isOpen) {
      const keyword = dom.historyInput?.value || '';
      if (keyword.trim() === '') {
        // 空关键词 → 加载全量历史（使用缓存）
        loadHistory();
      } else {
        // 非空 → 执行搜索
        performSearch(keyword);
      }
    }
  });
}

// ----- 搜索（直接请求，不缓存）-----
async function performSearch(keyword) {
  const trimKey = keyword.trim();
  if (!trimKey) {
    // 若关键词为空，则加载全量（并刷新缓存）
    appState.fullHistoryCache.data = null;
    appState.fullHistoryCache.timestamp = 0;
    await loadHistory();
    return;
  }

  appState.cancelHistoryRequest();
  appState.historyAbortCtrl = new AbortController();

  try {
    const res = await fetch(`${CONFIG.API_BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: trimKey }),
      signal: appState.historyAbortCtrl.signal
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.statusText = res.statusText;
      throw err;
    }
    const resp = await res.json();
    const listData = resp.data ?? [];
    // 直接渲染，不更新全量缓存
    renderHistoryList(listData, dom.historyList);
    if (listData.length === 0) showMessage("无匹配历史", "info");
  } catch (err) {
    if (err.name === 'AbortError') return;
    handleError(err, '搜索', false);
  } finally {
    appState.historyAbortCtrl = null;
  }
}

function initSearchButton() {
  dom.searchBtn?.addEventListener('click', () => performSearch(dom.historyInput?.value || ''));
  dom.historyInput?.addEventListener('keypress', e => {
    if (e.key === 'Enter') performSearch(dom.historyInput.value);
  });
}

// ============================================================
// 页面卸载清理
// ============================================================
function cleanup() {
  appState.resetPolling();
  appState.cancelHistoryRequest();
}

window.addEventListener('beforeunload', cleanup);

// ============================================================
// 初始化
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  initUploadArea();
  initFileInput();
  initCopyButton();
  initSaveButton();
  initHistoryButton();
  initSearchButton();
  initClearPreviewBtn();
  initClearHistoryBtn();
  initClearResultBtn();
  loadHistory();
});