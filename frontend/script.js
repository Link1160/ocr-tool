// frontend/script.js

const API_BASE = 'http://127.0.0.1:5000';

let currentTaskId = null;
let pollingInterval = null;

document.addEventListener('DOMContentLoaded', function() {
    initUploadArea();
    initFileInput();
    initCopyButton();
    initSaveButton();
    initHistoryButton();
    initSearchButton();
    loadHistory();
});

function initUploadArea() {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;

    dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });
}

function initFileInput() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput) return;

    fileInput.addEventListener('change', function(e) {
        const files = e.target.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
        fileInput.value = '';
    });
}

function handleFileUpload(file) {
    if (!file.type.startsWith('image/')) {
        showMessage('Please select an image file.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('image', file);

    showMessage('Uploading...', 'info');
    setLoadingState(true);

    fetch(API_BASE + '/upload', {
        method: 'POST',
        body: formData
    })
    .then(function(response) {
        if (!response.ok) {
            throw new Error('Upload failed: ' + response.status);
        }
        return response.json();
    })
    .then(function(data) {
        if (data.task_id) {
            currentTaskId = data.task_id;
            showMessage('Upload successful, processing...', 'info');
            startPolling(currentTaskId);
        } else {
            throw new Error('No task_id returned');
        }
    })
    .catch(function(error) {
        showMessage('Upload error: ' + error.message, 'error');
        setLoadingState(false);
    });
}

function startPolling(taskId) {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    let attempts = 0;
    const maxAttempts = 120;

    pollingInterval = setInterval(function() {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            showMessage('Processing timeout, please try again.', 'error');
            setLoadingState(false);
            return;
        }

        fetch(API_BASE + '/status/' + taskId)
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Status check failed: ' + response.status);
            }
            return response.json();
        })
        .then(function(data) {
            if (data.status === 'done') {
                clearInterval(pollingInterval);
                pollingInterval = null;
                setLoadingState(false);
                displayResult(data.result || '');
                showMessage('Processing complete!', 'success');
            } else if (data.status === 'pending' || data.status === 'doing') {
                showMessage('Processing... ' + (data.progress || ''), 'info');
            } else {
                clearInterval(pollingInterval);
                pollingInterval = null;
                setLoadingState(false);
                showMessage('Unknown status: ' + data.status, 'error');
            }
        })
        .catch(function(error) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            setLoadingState(false);
            showMessage('Status check error: ' + error.message, 'error');
        });
    }, 1000);
}

function displayResult(text) {
    const resultDiv = document.getElementById('resultText');
    const actionsDiv = document.getElementById('resultActions');

    if (resultDiv) {
        resultDiv.textContent = text || 'No text extracted.';
    }

    if (actionsDiv) {
        actionsDiv.style.display = 'block';
    }

    const copyBtn = document.getElementById('copyBtn');
    const saveBtn = document.getElementById('saveBtn');

    if (copyBtn) {
        copyBtn.dataset.text = text || '';
    }

    if (saveBtn) {
        saveBtn.dataset.taskId = currentTaskId || '';
    }
}

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
                .then(function() {
                    showMessage('Copied to clipboard!', 'success');
                })
                .catch(function() {
                    fallbackCopy(text);
                });
        } else {
            fallbackCopy(text);
        }
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
    try {
        document.execCommand('copy');
        showMessage('Copied to clipboard!', 'success');
    } catch (e) {
        showMessage('Copy failed, please select and copy manually.', 'error');
    }
    document.body.removeChild(textarea);
}

function initSaveButton() {
    const saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', function() {
        const taskId = this.dataset.taskId || currentTaskId;
        if (!taskId) {
            showMessage('No task available to save.', 'warning');
            return;
        }

        const downloadUrl = API_BASE + '/export/' + taskId;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = 'ocr_result_' + taskId + '.txt';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showMessage('Download started.', 'success');
    });
}

function loadHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    fetch(API_BASE + '/history')
    .then(function(response) {
        if (!response.ok) {
            throw new Error('History fetch failed: ' + response.status);
        }
        return response.json();
    })
    .then(function(data) {
        renderHistoryList(data, historyList);
    })
    .catch(function(error) {
        showMessage('Failed to load history: ' + error.message, 'error');
    });
}

function renderHistoryList(items, container) {
    container.innerHTML = '';

    if (!items || items.length === 0) {
        container.innerHTML = '<li class="history-empty">No history records.</li>';
        return;
    }

    items.forEach(function(item) {
        const li = document.createElement('li');
        li.className = 'history-item';

        const time = document.createElement('span');
        time.className = 'history-time';
        const date = new Date(item.time);
        time.textContent = date.toLocaleString();

        const text = document.createElement('span');
        text.className = 'history-text';
        const preview = item.text || '[empty]';
        text.textContent = preview.length > 60 ? preview.substring(0, 60) + '...' : preview;

        li.appendChild(time);
        li.appendChild(text);

        li.addEventListener('click', function() {
            if (item.text) {
                const resultDiv = document.getElementById('resultText');
                if (resultDiv) {
                    resultDiv.textContent = item.text;
                }
                const actionsDiv = document.getElementById('resultActions');
                if (actionsDiv) {
                    actionsDiv.style.display = 'block';
                }
                const copyBtn = document.getElementById('copyBtn');
                if (copyBtn) {
                    copyBtn.dataset.text = item.text;
                }
                const saveBtn = document.getElementById('saveBtn');
                if (saveBtn) {
                    saveBtn.dataset.taskId = '';
                }
                showMessage('Loaded from history.', 'success');
            }
        });

        container.appendChild(li);
    });
}

function initHistoryButton() {
    const historyBtn = document.getElementById('historyBtn');
    if (!historyBtn) return;

    historyBtn.addEventListener('click', function() {
        const sidebar = document.getElementById('historySidebar');
        if (sidebar) {
            sidebar.classList.toggle('open');
            if (sidebar.classList.contains('open')) {
                loadHistory();
            }
        }
    });
}

function initSearchButton() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');

    if (!searchBtn || !searchInput) return;

    searchBtn.addEventListener('click', function() {
        performSearch(searchInput.value);
    });

    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch(searchInput.value);
        }
    });
}

function performSearch(keyword) {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    if (!keyword || keyword.trim() === '') {
        loadHistory();
        return;
    }

    const payload = { keyword: keyword.trim() };

    fetch(API_BASE + '/search', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(function(response) {
        if (!response.ok) {
            throw new Error('Search failed: ' + response.status);
        }
        return response.json();
    })
    .then(function(data) {
        renderHistoryList(data, historyList);
        if (data && data.length > 0) {
            showMessage('Found ' + data.length + ' results.', 'success');
        } else {
            showMessage('No results found.', 'warning');
        }
    })
    .catch(function(error) {
        showMessage('Search error: ' + error.message, 'error');
    });
}

function setLoadingState(loading) {
    const uploadBtn = document.getElementById('uploadBtn');
    const dropZone = document.getElementById('dropZone');
    if (uploadBtn) {
        uploadBtn.disabled = loading;
        uploadBtn.textContent = loading ? 'Processing...' : 'Upload';
    }
    if (dropZone) {
        dropZone.style.opacity = loading ? '0.5' : '1';
    }
}

function showMessage(msg, type) {
    const msgContainer = document.getElementById('messageContainer');
    if (!msgContainer) {
        console.log('[' + (type || 'info') + '] ' + msg);
        return;
    }

    const div = document.createElement('div');
    div.className = 'message ' + (type || 'info');
    div.textContent = msg;

    msgContainer.appendChild(div);

    setTimeout(function() {
        if (div.parentNode) {
            div.parentNode.removeChild(div);
        }
    }, 4000);
}