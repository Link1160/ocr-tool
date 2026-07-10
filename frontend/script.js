const API_BASE = 'http://127.0.0.1:5000';
let currentTaskId = null;
let pollingInterval = null;
let currentBoxImgUrl = "";

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

// 清空预览图片（不触碰右侧识别文字）
function clearAllPreview() {
    const wrap = document.getElementById("box-preview-wrap");
    const img = document.getElementById("box-preview-img");
    const emptyTip = document.getElementById("preview-empty");
    wrap.hidden = true;
    img.src = "";
    emptyTip.style.display = "block";
    currentBoxImgUrl = "";
    currentTaskId = null;
}

function initClearPreviewBtn() {
    const clearBtn = document.getElementById("btn-clear-preview");
    clearBtn.addEventListener("click", clearAllPreview);
}

// 仅清空右侧文本框
function initClearResultBtn() {
    const clearResBtn = document.getElementById("btn-clear-result");
    clearResBtn.addEventListener("click", () => {
        const resultText = document.getElementById("resultText");
        const actionWrap = document.getElementById("resultActions");
        resultText.value = "";
        actionWrap.style.display = "none";
        currentTaskId = null;
    });
}

// 清空历史（仅清空历史列表，不影响右侧识别结果）
function initClearHistoryBtn() {
    const clearHisBtn = document.getElementById("btn-clear-history");
    clearHisBtn.addEventListener("click", async () => {
        if (!confirm("确定永久清空全部识别历史？此操作不可撤销")) return;
        try {
            const res = await fetch(`${API_BASE}/clear_history`, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            const resp = await res.json();
            if (resp.code === 200) {
                showMessage("历史已全部清空", "success");
                const historyList = document.getElementById("historyList");
                historyList.innerHTML = '<li class="history-list__empty">暂无历史记录</li>';
                const wrap = document.getElementById("box-preview-wrap");
                const img = document.getElementById("box-preview-img");
                const emptyTip = document.getElementById("preview-empty");
                wrap.hidden = true;
                img.src = "";
                emptyTip.style.display = "block";
                currentBoxImgUrl = "";
            } else {
                showMessage(`清空失败：${resp.message || "服务器异常"}`, "error");
            }
        } catch (err) {
            showMessage(`清空失败：${err.message}`, "error");
        }
    });
}

function initUploadArea() {
    const dropZone = document.getElementById('dropZone');
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
    const fileInput = document.getElementById('fileInput');
    if (!fileInput) return;
    fileInput.addEventListener('change', e => {
        const files = e.target.files;
        if (files.length > 0) handleFileUpload(files[0]);
        fileInput.value = '';
    });
}

// 【修复：MIME + 后缀名双重校验，解决类型误拦截】
function handleFileUpload(file) {
    const allowMime = ['image/jpeg','image/png','image/gif','image/webp','image/bmp'];
    const allowExt = ['jpg','jpeg','png','gif','webp','bmp'];
    const fileName = file.name.toLowerCase();
    const fileExt = fileName.split('.').pop();
    const isImage = allowMime.includes(file.type) || allowExt.includes(fileExt);

    if (!isImage) {
        showMessage('当前不支持该文件类型，请上传jpg/png/gif/webp/bmp图片', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);
    showMessage('正在上传图片...', 'info');
    setLoadingState(true);
    fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(resp => {
        if (!resp || resp.code !== 200) {
            throw new Error(resp?.msg || "服务器返回异常");
        }
        if (!resp.task_id) {
            throw new Error("后端未返回任务ID");
        }
        currentTaskId = resp.task_id;
        startPolling(currentTaskId);
    })
    .catch(err => {
        showMessage(`上传失败: ${err.message}`, 'error');
        setLoadingState(false);
    });
}

// 历史记录重新识别
function reRecognizeByHistoryImgUrl(imgUrl) {
    showMessage("正在重新加载该图片并识别...", "info");
    setLoadingState(true);
    fetch(imgUrl)
    .then(res => res.blob())
    .then(blob => {
        const file = new File([blob], "history_temp.jpg", { type: "image/jpeg" });
        const formData = new FormData();
        formData.append("image", file);
        fetch(`${API_BASE}/upload`, {
            method: "POST",
            body: formData
        })
        .then(res => res.json())
        .then(resp => {
            if (!resp || resp.code !== 200 || !resp.task_id) {
                throw new Error("上传未获取任务ID");
            }
            currentTaskId = resp.task_id;
            startPolling(currentTaskId);
        })
        .catch(err => {
            showMessage(`重新识别图片失败：${err.message}`, "error");
            setLoadingState(false);
        });
    })
    .catch(err => {
        showMessage("读取历史原图失败，图片地址失效", "error");
        setLoadingState(false);
    });
}

// 轮询任务状态
function startPolling(taskId) {
    if (pollingInterval) clearInterval(pollingInterval);
    let attempts = 0;
    const maxAttempts = 120;
    pollingInterval = setInterval(() => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            showMessage('识别超时，请重新上传图片', 'error');
            setLoadingState(false);
            return;
        }
        fetch(`${API_BASE}/status/${taskId}`)
        .then(res => res.json())
        .then(resp => {
            if (!resp || resp.code !== 200) throw new Error(resp?.msg || "查询任务失败");
            const data = resp.data;
            if (data.status === "done") {
                clearInterval(pollingInterval);
                pollingInterval = null;
                setLoadingState(false);
                displayResult(data.result || '', taskId);
                if (data.box_img_url) {
                    currentBoxImgUrl = data.box_img_url;
                    const wrap = document.getElementById("box-preview-wrap");
                    const imgDom = document.getElementById("box-preview-img");
                    wrap.hidden = false;
                    imgDom.src = currentBoxImgUrl;
                    document.getElementById("preview-empty").style.display = "none";
                }
                showMessage('识别完成！', 'success');
                loadHistory();
            } else if (data.status === 'pending' || data.status === 'doing') {
                showMessage('正在识别图片...', 'info');
            } else {
                clearInterval(pollingInterval);
                pollingInterval = null;
                setLoadingState(false);
                showMessage(`识别失败: ${data.error || "未知错误"}`, 'error');
            }
        })
        .catch(err => {
            clearInterval(pollingInterval);
            pollingInterval = null;
            setLoadingState(false);
            showMessage(`查询任务状态失败: ${err.message}`, 'error');
        });
    }, 1000);
}

// 渲染识别结果
function displayResult(text, taskId) {
    const resultDiv = document.getElementById('resultText');
    const actionsDiv = document.getElementById('resultActions');
    if (resultDiv) resultDiv.value = text || '';
    if (actionsDiv) actionsDiv.style.display = 'flex';
    const copyBtn = document.getElementById('copyBtn');
    const saveBtn = document.getElementById('saveBtn');
    if (copyBtn) copyBtn.dataset.text = text || '';
    if (saveBtn) saveBtn.dataset.taskId = taskId || '';
}

// 复制按钮
function initCopyButton() {
    const copyBtn = document.getElementById('copyBtn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', function() {
        const text = this.dataset.text || '';
        if (!text) {
            showMessage('暂无内容可复制', 'warning');
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            showMessage('复制成功', 'success');
        }).catch(() => {
            fallbackCopy(text);
        });
    });
}

function fallbackCopy(text) {
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
}

// 导出按钮
function initSaveButton() {
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', async function() {
        const taskId = this.dataset.taskId || currentTaskId;
        if (!taskId) {
            showMessage('无识别任务，无法导出', 'warning');
            return;
        }
        const res = await fetch(`${API_BASE}/export/${taskId}`);
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `ocr_result_${taskId}.txt`;
        document.body.appendChild(link);
        link.click();
        URL.revokeObjectURL(link.href);
        document.body.removeChild(link);
        showMessage('文件已下载', 'success');
    });
}

// 加载历史记录
function loadHistory() {
    const historyList = document.getElementById("historyList");
    if (!historyList) return;
    const cacheBustUrl = `${API_BASE}/history?t=${Date.now()}`;
    fetch(cacheBustUrl, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" }
    })
    .then(res => res.json())
    .then(resp => {
        const listData = resp.data ?? [];
        renderHistoryList(listData, historyList);
    })
    .catch(err => {
        showMessage(`加载历史失败: ${err.message}`, "error");
    });
}

// 渲染历史列表
function renderHistoryList(items, container) {
    container.innerHTML = '';
    if (!items || !Array.isArray(items) || items.length === 0) {
        container.innerHTML = '<li class="history-list__empty">暂无历史记录</li>';
        return;
    }
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
        container.appendChild(li);
    });
}

// 历史侧边栏开关
function initHistoryButton() {
    const historyBtn = document.getElementById('historyBtn');
    const sidebar = document.getElementById('historySidebar');
    if (!historyBtn || !sidebar) return;
    historyBtn.addEventListener('click', function() {
        sidebar.classList.toggle('open');
        if (sidebar.classList.contains('open')) {
            loadHistory();
        }
    });
}

// 历史搜索
function initSearchButton() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('historyInput');
    if (!searchBtn || !searchInput) return;
    searchBtn.addEventListener('click', () => performSearch(searchInput.value));
    searchInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') performSearch(searchInput.value);
    });
}

async function performSearch(keyword) {
    const historyList = document.getElementById("historyList");
    if (!historyList) return;
    const trimKey = keyword.trim();
    if (!trimKey) {
        await loadHistory();
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keyword: trimKey })
        });
        const resp = await res.json();
        const listData = resp.data ?? [];
        renderHistoryList(listData, historyList);
        if (listData.length === 0) showMessage("无匹配历史", "info");
    } catch (err) {
        showMessage(`搜索失败：${err.message}`, "error");
    }
}

// 加载状态切换
function setLoadingState(loading) {
    const dropZone = document.getElementById('dropZone');
    if (dropZone) dropZone.style.opacity = loading ? "0.5" : "1";
}

// 全局消息提示
function showMessage(msg, type) {
    const container = document.getElementById("messageContainer");
    if (!container) return console.log(`[${type}] ${msg}`);
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}