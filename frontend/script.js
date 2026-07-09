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

// 绑定清空预览按钮
function initClearPreviewBtn() {
    const clearBtn = document.getElementById("btn-clear-preview");
    clearBtn.addEventListener("click", clearAllPreview);
}

// 绑定清空识别结果按钮
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

// 绑定【清空全部历史】按钮（修复：只清左侧预览、历史列表，保留右侧文字）
function initClearHistoryBtn() {
    const clearHisBtn = document.getElementById("btn-clear-history");
    clearHisBtn.addEventListener("click", async () => {
        if (!confirm("确定清空所有图片识别历史？该操作不可恢复")) return;
        try {
            const res = await fetch(`${API_BASE}/clear_history`, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            const resp = await res.json();
            if (resp.code === 200) {
                showMessage("历史已全部永久清空", "success");
                // 清空历史列表DOM
                const historyList = document.getElementById("historyList");
                historyList.innerHTML = '<li class="history-list__empty" id="history-empty">暂无历史记录</li>';

                // 仅清空左侧图片预览区域，不清除右侧识别文字
                const wrap = document.getElementById("box-preview-wrap");
                const img = document.getElementById("box-preview-img");
                const emptyTip = document.getElementById("preview-empty");
                wrap.hidden = true;
                img.src = "";
                emptyTip.style.display = "block";
                currentBoxImgUrl = "";

                // 刷新历史列表
                setTimeout(() => loadHistory(), 150);
            } else {
                showMessage(resp.error || "清空失败", "error");
            }
        } catch (err) {
            showMessage(`请求失败：${err.message}`, "error");
            console.error("清空历史接口报错：", err);
        }
    });
}

// 清空预览按钮专用：完整清空图+文字（单独按钮使用）
function clearAllPreview() {
    const wrap = document.getElementById("box-preview-wrap");
    const img = document.getElementById("box-preview-img");
    const emptyTip = document.getElementById("preview-empty");
    wrap.hidden = true;
    img.src = "";
    emptyTip.style.display = "block";
    currentBoxImgUrl = "";
    const resultDiv = document.getElementById('resultText');
    const actionsDiv = document.getElementById('resultActions');
    if(resultDiv) resultDiv.value = '';
    if(actionsDiv) actionsDiv.style.display = 'none';
    currentTaskId = null;
}

// 拖拽上传区域
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

// 文件选择框
function initFileInput() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput) return;
    fileInput.addEventListener('change', e => {
        const files = e.target.files;
        if (files.length > 0) handleFileUpload(files[0]);
        fileInput.value = '';
    });
}

// 本地文件上传识别
function handleFileUpload(file) {
    const allowImg = ['image/jpeg','image/jpg','image/png','image/gif','image/webp','image/bmp'];
    if (!allowImg.includes(file.type)) {
        showMessage('当前不支持该文件类型，请尝试其他图片', 'error');
        return;
    }
    const formData = new FormData();
    formData.append('image', file);
    showMessage('Uploading...', 'info');
    setLoadingState(true);
    fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(resp => {
        console.log('后端完整返回：', resp);
        if (resp.code !== 200) throw new Error(resp.error || '上传失败');
        if (!resp.data) throw new Error('服务器返回数据为空');
        const data = resp.data;
        if (data.task_id) {
            currentTaskId = data.task_id;
            showMessage('Upload successful, processing...', 'info');
            startPolling(currentTaskId);
        } else {
            throw new Error('未获取到任务ID');
        }
    })
    .catch(err => {
        console.error('上传完整错误：', err);
        showMessage('Upload error: ' + err.message, 'error');
        setLoadingState(false);
    });
}

// 通过历史原图URL重新发起识别（点击历史重新识别原图）
function reRecognizeByHistoryImgUrl(imgUrl) {
    showMessage("正在重新加载该图片并识别...", "info");
    setLoadingState(true);
    fetch(imgUrl)
    .then(res => res.blob())
    .then(blob => {
        const file = new File([blob], "history_temp.jpg", { type: blob.type });
        const formData = new FormData();
        formData.append("image", file);
        fetch(`${API_BASE}/upload`, {
            method: "POST",
            body: formData
        })
        .then(res => res.json())
        .then(resp => {
            if (resp.code !== 200) throw new Error(resp.error);
            const data = resp.data;
            if (data.task_id) {
                currentTaskId = data.task_id;
                startPolling(currentTaskId);
            }
        })
        .catch(err => {
            showMessage("重新识别图片失败：" + err.message, "error");
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
            showMessage('Processing timeout, please try again.', 'error');
            setLoadingState(false);
            return;
        }
        fetch(`${API_BASE}/status/${taskId}`)
        .then(res => res.json())
        .then(resp => {
            if (resp.code !== 200) throw new Error(resp.error);
            const data = resp.data;
            if (data.status === 'done') {
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
                showMessage('Processing complete!', 'success');
                loadHistory();
            } else if (data.status === 'pending' || data.status === 'doing') {
                showMessage('Processing...', 'info');
            } else {
                clearInterval(pollingInterval);
                pollingInterval = null;
                setLoadingState(false);
                showMessage('Unknown status: ' + data.status, 'error');
            }
        })
        .catch(err => {
            clearInterval(pollingInterval);
            pollingInterval = null;
            setLoadingState(false);
            showMessage('Status check error: ' + err.message, 'error');
        });
    }, 1000);
}

// 展示识别文本
function displayResult(text, taskId) {
    const resultDiv = document.getElementById('resultText');
    const actionsDiv = document.getElementById('resultActions');
    if (resultDiv) resultDiv.textContent = text || 'No text extracted.';
    if (actionsDiv) actionsDiv.style.display = 'block';
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
            showMessage('Nothing to copy.', 'warning');
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => showMessage('Copied to clipboard!', 'success'))
                .catch(() => fallbackCopy(text));
        } else fallbackCopy(text);
    });
}

// 兼容复制
function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showMessage('Copied to clipboard!', 'success');
    } catch {
        showMessage('Copy failed, please select and copy manually.', 'error');
    }
    document.body.removeChild(textarea);
}

// 导出txt按钮
function initSaveButton() {
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', function() {
        const taskId = this.dataset.taskId || currentTaskId;
        if (!taskId) {
            showMessage('No task available to save.', 'warning');
            return;
        }
        const link = document.createElement('a');
        link.href = `${API_BASE}/export/${taskId}`;
        link.download = 'ocr_result_' + taskId + '.txt';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showMessage('Download started.', 'success');
    });
}

// 加载全部历史
function loadHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    fetch(`${API_BASE}/history`)
    .then(res => res.json())
    .then(resp => {
        if (resp.code !== 200) throw new Error(resp.error);
        renderHistoryList(resp.data, historyList);
    })
    .catch(err => showMessage('Failed to load history: ' + err.message, 'error'));
}

// 渲染历史：点击重新识别原图
function renderHistoryList(items, container) {
    container.innerHTML = '';
    if (!items || items.length === 0) {
        container.innerHTML = '<li class="history-list__empty" id="history-empty">暂无历史记录</li>';
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

        // 点击历史重新识别原图
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

// 历史侧边展开/收起
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

// 搜索历史
function initSearchButton() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('historyInput');
    if (!searchBtn || !searchInput) return;
    searchBtn.addEventListener('click', () => performSearch(searchInput.value));
    searchInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') performSearch(searchInput.value);
    });
}

function performSearch(keyword) {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    if (!keyword.trim()) return loadHistory();
    fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ keyword: keyword.trim() })
    })
    .then(res => res.json())
    .then(resp => {
        if (resp.code !== 200) throw new Error(resp.error);
        renderHistoryList(resp.data, historyList);
        if (resp.data.length > 0) showMessage(`找到 ${resp.data.length} 条图片记录`, 'success');
        else showMessage('无匹配图片记录', 'warning');
    })
    .catch(err => showMessage('搜索失败: ' + err.message, 'error'));
}

// 加载中状态
function setLoadingState(loading) {
    const uploadBtn = document.getElementById('btn-start-ocr');
    const dropZone = document.getElementById('dropZone');
    if (uploadBtn) {
        uploadBtn.disabled = loading;
        uploadBtn.textContent = loading ? 'Processing...' : 'Upload';
    }
    if (dropZone) dropZone.style.opacity = loading ? '0.5' : '1';
}

// 全局弹窗提示
function showMessage(msg, type) {
    const msgContainer = document.getElementById('messageContainer');
    if (!msgContainer) return console.log('[' + (type || 'info') + '] ' + msg);
    const div = document.createElement('div');
    div.className = 'message ' + (type || 'info');
    div.textContent = msg;
    msgContainer.appendChild(div);
    setTimeout(function() {
        if (div.parentNode) div.parentNode.removeChild(div);
    }, 4000);
}