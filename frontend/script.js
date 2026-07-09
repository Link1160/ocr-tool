// frontend/script.js
// OCR 前端控制脚本 (完整修复版 - v1.1)

// ==================== 全局配置 ====================
const API_BASE = 'http://127.0.0.1:5000';

// PDF.js Worker 配置 (修复：防止 PDF 解析崩溃)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ==================== 全局状态 ====================
let currentTaskId = null;
let pollingInterval = null;
let activeObjectUrls = []; // 用于追踪 Blob URLs，防止内存泄漏

// ==================== DOM Ready ====================
document.addEventListener('DOMContentLoaded', () => {
    initUpload();
    initResultActions();
    initHistory();
});

/* ==================================================
   一、上传模块 (Upload)
   ================================================== */
function initUpload() {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const previewGrid = document.getElementById('preview-grid');
    const previewEmpty = document.getElementById('preview-empty');
    const btnStart = document.getElementById('btn-start-ocr');
    const btnCancel = document.getElementById('btn-cancel-ocr');
    const btnClearPreview = document.getElementById('btn-clear-preview');

    // 1. 点击上传
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = ''; // 允许重复选择同一文件
    });

    // 2. 拖拽上传
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    // 3. 粘贴上传 (Ctrl+V)
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData.items;
        for (let item of items) {
            if (item.type.startsWith('image/')) {
                handleFiles([item.getAsFile()]);
            }
        }
    });

    // 4. 处理文件入口
    function handleFiles(files) {
        if (!files.length) return;
        
        // 修复：虽然 input 支持 multiple，但业务逻辑限定单文件，仅取第一个
        const file = files[0];

        // 清空旧预览及释放内存
        clearPreviewResources();
        previewGrid.hidden = false;
        previewEmpty.hidden = true;

        if (file.type.startsWith('image/')) {
            const objectUrl = URL.createObjectURL(file);
            activeObjectUrls.push(objectUrl); // 追踪以便释放
            renderPreviewAndUpload(file, objectUrl);
        } else if (file.type === 'application/pdf') {
            showMessage('检测到 PDF，正在转换页面...', 'info');
            renderPdfPreview(file);
        } else {
            showMessage('不支持的文件格式，请上传 JPG、PNG 或 PDF', 'error');
            previewEmpty.hidden = false;
            previewGrid.hidden = true;
        }
    }

    // 5. 渲染预览并执行上传
    function renderPreviewAndUpload(file, srcUrl) {
        const template = document.getElementById('preview-item-template');
        const node = template.content.cloneNode(true);
        
        const imgElement = node.querySelector('.preview-item__img');
        const nameElement = node.querySelector('.preview-item__name');

        imgElement.src = srcUrl;
        nameElement.textContent = file.name;
        
        previewGrid.appendChild(node);
        uploadFile(file);
    }

    // 6. PDF 渲染逻辑 (使用 PDF.js)
    function renderPdfPreview(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const typedarray = new Uint8Array(e.target.result);
            pdfjsLib.getDocument(typedarray).promise.then(function(pdf) {
                pdf.getPage(1).then(function(page) {
                    const scale = 1.5;
                    const viewport = page.getViewport({ scale: scale });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    page.render({ canvasContext: context, viewport: viewport }).promise.then(() => {
                        canvas.toBlob(blob => {
                            const pdfImageFile = new File([blob], `${file.name}_page1.png`, { type: 'image/png' });
                            const objectUrl = URL.createObjectURL(pdfImageFile);
                            activeObjectUrls.push(objectUrl);
                            renderPreviewAndUpload(pdfImageFile, objectUrl);
                        });
                    });
                });
            }).catch(err => {
                showMessage('PDF 解析失败，请确保文件未损坏', 'error');
                console.error('PDF.js error:', err);
                previewEmpty.hidden = false;
                previewGrid.hidden = true;
            });
        };
        reader.readAsArrayBuffer(file);
    }

    // 7. 上传到后端
    function uploadFile(file) {
        const formData = new FormData();
        formData.append('image', file);
        
        setLoadingState(true);
        showMessage('上传中...', 'info');

        fetch(`${API_BASE}/upload`, { method: 'POST', body: formData })
            .then(res => res.json())
            .then(data => {
                if (data.task_id) {
                    currentTaskId = data.task_id;
                    showMessage('上传成功，开始识别...', 'success');
                    startPolling(data.task_id);
                } else {
                    throw new Error(data.error || '后端未返回 Task ID');
                }
            })
            .catch(err => {
                showMessage(`上传失败: ${err.message}`, 'error');
                setLoadingState(false);
            });
    }

    // 8. 开始识别按钮
    // 修复：由于采用“上传即识别”模式，这里仅做状态检查，避免误操作
    btnStart.addEventListener('click', () => {
        if (!previewGrid.hasChildNodes() || previewGrid.hidden) {
            showMessage('请先上传图片或 PDF', 'warning');
        } else if (!currentTaskId) {
            showMessage('任务未启动，请等待上传完成', 'warning');
        }
    });

    // 9. 取消识别按钮
    btnCancel.addEventListener('click', () => {
        if (!currentTaskId) return;
        
        // 修复：先停止轮询，防止后端返回导致 UI 状态回弹
        clearInterval(pollingInterval);
        pollingInterval = null;

        fetch(`${API_BASE}/cancel/${currentTaskId}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                showMessage('识别已取消', 'info');
            })
            .catch(err => showMessage(`取消失败: ${err.message}`, 'error'))
            .finally(() => {
                // 无论成败，UI 都应恢复正常
                setLoadingState(false);
                currentTaskId = null;
            });
    });

    // 10. 清空预览
    btnClearPreview.addEventListener('click', () => {
        clearPreviewResources();
        previewGrid.innerHTML = '';
        previewGrid.hidden = true;
        previewEmpty.hidden = false;
        setLoadingState(false);
        
        // 停止可能存在的轮询
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        currentTaskId = null;
        showMessage('预览已清空', 'info');
    });

    // 辅助函数：专门用于清理 Blob URL 内存
    function clearPreviewResources() {
        activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
        activeObjectUrls = [];
    }
}

/* ==================================================
   二、结果模块 (Result)
   ================================================== */
function initResultActions() {
    const resultText = document.getElementById('result-text');
    const resultMeta = document.getElementById('result-meta');
    const btnCopy = document.getElementById('btn-copy');
    const btnSave = document.getElementById('btn-save-txt');
    const btnClear = document.getElementById('btn-clear-result');

    btnCopy.addEventListener('click', async () => {
        if (!resultText.value) return showMessage('无内容可复制', 'warning');
        try {
            await navigator.clipboard.writeText(resultText.value);
            showMessage('已复制到剪贴板', 'success');
        } catch { showMessage('复制失败', 'error'); }
    });

    btnSave.addEventListener('click', () => {
        if (!currentTaskId) return showMessage('没有可导出的任务', 'warning');
        const link = document.createElement('a');
        link.href = `${API_BASE}/export/${currentTaskId}`;
        link.download = `ocr_result_${currentTaskId}.txt`;
        link.click();
        showMessage('开始下载...', 'success');
    });

    btnClear.addEventListener('click', () => {
        resultText.value = '';
        updateWordCount(''); // 修复：清空时也更新计数
        showMessage('结果已清空', 'info');
    });
}

/* ==================================================
   三、历史记录模块 (History)
   ================================================== */
function initHistory() {
    const historyList = document.getElementById('history-list');
    const historyEmpty = document.getElementById('history-empty');
    const searchInput = document.getElementById('history-search');
    const btnSearch = document.getElementById('btn-search');
    const btnClearHistory = document.getElementById('btn-clear-history');

    loadHistory();

    btnSearch.addEventListener('click', () => performSearch(searchInput.value));
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch(searchInput.value);
    });

    btnClearHistory.addEventListener('click', () => {
        fetch(`${API_BASE}/history`, { method: 'DELETE' })
            .then(() => {
                loadHistory();
                showMessage('历史记录已清空', 'success');
            })
            .catch(err => showMessage(`清空失败: ${err.message}`, 'error'));
    });
}

function loadHistory() {
    fetch(`${API_BASE}/history`)
        .then(res => res.json())
        .then(data => renderHistory(data))
        .catch(err => console.error('加载历史失败:', err));
}

function performSearch(keyword) {
    if (!keyword.trim()) return loadHistory();
    fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim() })
    })
    .then(res => res.json())
    .then(data => renderHistory(data))
    .catch(err => showMessage(`搜索失败: ${err.message}`, 'error'));
}

function renderHistory(data) {
    const historyList = document.getElementById('history-list');
    const historyEmpty = document.getElementById('history-empty');
    const template = document.getElementById('history-item-template');
    
    historyList.innerHTML = '';
    
    if (!data || data.length === 0) {
        historyEmpty.hidden = false;
        return;
    }
    
    historyEmpty.hidden = true;
    data.forEach(item => {
        const node = template.content.cloneNode(true);
        const btn = node.querySelector('.history-item__btn');
        const title = node.querySelector('.history-item__title');
        const time = node.querySelector('.history-item__time');

        title.textContent = item.text ? item.text.substring(0, 40) + '...' : '无文本内容';
        time.textContent = new Date(item.time).toLocaleString();
        time.dateTime = item.time;

        btn.addEventListener('click', () => {
            const resultText = document.getElementById('result-text');
            resultText.value = item.text || '';
            // 修复：点击历史记录时必须手动更新字数
            updateWordCount(item.text || '');
            if (item.task_id) currentTaskId = item.task_id;
            showMessage('已加载历史记录', 'info');
        });
        historyList.appendChild(node);
    });
}

/* ==================================================
   四、通用工具函数 (Utils)
   ================================================== */
function startPolling(taskId) {
    if (pollingInterval) clearInterval(pollingInterval);
    
    pollingInterval = setInterval(() => {
        fetch(`${API_BASE}/status/${taskId}`)
            .then(res => res.json())
            .then(data => {
                if (data.status === 'done') {
                    stopPolling();
                    setLoadingState(false);
                    const resultText = data.result || '';
                    document.getElementById('result-text').value = resultText;
                    updateWordCount(resultText);
                    loadHistory(); // 刷新历史列表
                    showMessage('识别完成', 'success');
                } else if (data.status === 'error') {
                    stopPolling();
                    setLoadingState(false);
                    showMessage(`识别失败: ${data.error || ''}`, 'error');
                } else {
                    showMessage(`处理中: ${data.progress || ''}`, 'info');
                }
            })
            .catch(err => {
                stopPolling();
                setLoadingState(false);
                showMessage(`状态检查失败: ${err.message}`, 'error');
            });
    }, 1500);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

function updateWordCount(text) {
    document.getElementById('result-meta').textContent = `字数：${text.length}`;
}

function setLoadingState(isLoading) {
    const startBtn = document.getElementById('btn-start-ocr');
    const cancelBtn = document.getElementById('btn-cancel-ocr');
    const uploadZone = document.getElementById('upload-zone');
    
    startBtn.disabled = isLoading;
    cancelBtn.disabled = !isLoading;
    uploadZone.style.opacity = isLoading ? '0.6' : '1';
    uploadZone.style.pointerEvents = isLoading ? 'none' : 'auto';
}

// 简易 Toast 替代 console.log (UI 体验优化)
function showMessage(msg, type) {
    console.log(`[${type}] ${msg}`);
    // 如果后续引入 Toast UI，在此处替换即可
}