import os
import threading
import time
import json
from flask import Flask, request, jsonify, send_file, send_from_directory, make_response
from flask_cors import CORS
import task_queue
import image_utils
from history_manager import bst, add_ocr_record, get_all_records, search_records, RECORD_JSON, HISTORY_ROOT, BOX_SUB_DIR, TXT_SUB_DIR

app = Flask(__name__)
CORS(app, supports_credentials=True, resources={r"/*": {"origins": "*"}})

UPLOAD_FOLDER = 'uploads'
RESULT_FOLDER = 'results'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULT_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

@app.route("/static/<folder>/<filename>")
def static_file(folder, filename):
    dir_map = {
        "upload": UPLOAD_FOLDER,
        "boxed": BOX_SUB_DIR,
        "txt": TXT_SUB_DIR
    }
    if folder not in dir_map:
        return jsonify({"code": 404, "data": None, "error": "资源不存在"}), 404
    return send_from_directory(dir_map[folder], filename)

# 前端路由（backend与frontend同级）
@app.route('/', methods=['GET'])
def home():
    return send_from_directory("../frontend", "index.html")

@app.route('/<filename>')
def load_frontend_file(filename):
    return send_from_directory("../frontend", filename)

@app.route('/assets/<path:filename>')
def load_asset(filename):
    return send_from_directory("../frontend/assets", filename)

# OCR后台线程
def worker():
    print("正在加载PaddleOCR模型，请稍候...")
    print("OCR模型加载完成，后台工作线程已启动！")
    while True:
        task_id = None
        try:
            task_id = task_queue.get_next_task()
            if task_id is None:
                time.sleep(0.5)
                continue
            task_info = task_queue.get_task_info(task_id)
            if not task_info:
                continue
            file_path = task_info["file_path"]
            task_queue.update_status(task_id, "doing")
            print(f"正在识别任务 {task_id} : {file_path}")

            ocr_res = image_utils.run_ocr(file_path)
            result_text = ocr_res.full_text
            box_data = ocr_res.box_list
            box_img_full = ocr_res.box_img_path

            if "失败" in result_text or not result_text.strip():
                task_queue.update_status(task_id, "failed", error="识别内容为空")
            else:
                box_filename = os.path.basename(box_img_full)
                box_img_url = f"http://127.0.0.1:5000/static/boxed/{box_filename}"
                filename = os.path.basename(file_path)
                img_url = f"http://127.0.0.1:5000/static/upload/{filename}"
                txt_name = os.path.splitext(filename)[0] + ".txt"
                txt_url = f"http://127.0.0.1:5000/static/txt/{txt_name}"
                task_queue.update_status(task_id, "done", result=result_text, box_img_url=box_img_url, original_img_url=img_url)
                add_ocr_record(
                    timestamp=time.time(),
                    img_url=img_url,
                    box_img_url=box_img_url,
                    txt_url=txt_url,
                    full_text=result_text,
                    box_data=box_data
                )
            print(f"任务 {task_id} 处理完成")
        except Exception as e:
            print(f"后台线程出错: {e}")
            if task_id:
                task_queue.update_status(task_id, "failed", error=str(e))
            time.sleep(1)

thread = threading.Thread(target=worker, daemon=True)
thread.start()

@app.route('/ping', methods=['GET'])
def ping():
    return jsonify({"code": 200, "data": {"status": "ok", "message": "服务在线"}})

@app.route('/upload', methods=['POST'])
def upload_image():
    if 'image' not in request.files:
        return jsonify({"code": 400, "data": None, "error": "没有图片文件"})
    file = request.files['image']
    if file.filename == '':
        return jsonify({"code": 400, "data": None, "error": "文件名为空"})
    file_path = os.path.join(UPLOAD_FOLDER, file.filename)
    if os.path.exists(file_path):
        base, ext = os.path.splitext(file.filename)
        file_path = os.path.join(UPLOAD_FOLDER, f"{base}_{int(time.time())}{ext}")
    file.save(file_path)
    task_id = task_queue.add_task(file_path)
    return jsonify({
        "code": 200,
        "data": {"task_id": task_id},
        "message": "图片上传成功，已加入识别队列"
    })

@app.route('/status/<task_id>', methods=['GET'])
def get_status(task_id):
    info = task_queue.get_task_info(task_id)
    if not info:
        return jsonify({"code": 404, "data": None, "error": "任务ID不存在"})
    resp_data = {
        "task_id": task_id,
        "status": info["status"]
    }
    if info["status"] == "done":
        resp_data["result"] = info.get("result", "")
        resp_data["box_img_url"] = info.get("box_img_url", "")
        resp_data["original_img_url"] = info.get("original_img_url", "")
    elif info["status"] == "failed":
        resp_data["error"] = info.get("error", "未知识别失败")
    return jsonify({"code": 200, "data": resp_data})

@app.route('/crop', methods=['POST'])
def crop_and_recognize():
    data = request.get_json()
    required = ['original_path', 'x1', 'y1', 'x2', 'y2']
    if not all(k in data for k in required):
        return jsonify({"code": 400, "data": None, "error": "缺少 original_path,x1,y1,x2,y2"})
    timestamp = int(time.time())
    crop_save_path = os.path.join(UPLOAD_FOLDER, f"crop_{timestamp}.jpg")
    image_utils.crop_image(data["original_path"], crop_save_path, data["x1"], data["y1"], data["x2"], data["y2"])
    task_id = task_queue.add_task(crop_save_path)
    return jsonify({
        "code": 200,
        "data": {"task_id": task_id, "cropped_path": crop_save_path}
    })

# 获取历史，全局禁用缓存
@app.route('/history', methods=["GET"])
def get_history():
    records = get_all_records()
    resp = make_response(jsonify({"code": 200, "data": records}))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

@app.route('/search', methods=["POST"])
def search_history():
    req = request.get_json()
    keyword = req.get("keyword", "").strip()
    match_list = search_records(keyword)
    return jsonify({"code": 200, "data": match_list})

@app.route('/export/<task_id>', methods=['GET'])
def export_result(task_id):
    info = task_queue.get_task_info(task_id)
    if not info:
        return jsonify({"code": 404, "data": None, "error": "任务不存在"})
    if info["status"] != "done":
        return jsonify({"code": 400, "data": None, "error": "任务未完成，无法导出"})
    text = info.get("result", "").strip()
    if not text:
        return jsonify({"code": 400, "data": None, "error": "识别文本为空"})
    txt_path = os.path.join(RESULT_FOLDER, f"{task_id}.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(text)
    return send_file(txt_path, as_attachment=True, download_name=f"{task_id}_ocr结果.txt")

# 【核心修复】彻底清空：删除文件 + 完全重置内存BST树，杜绝新识别回弹旧历史
# 彻底清空所有历史（修复回弹：调用封装好的完整清空函数）
@app.route('/clear_history', methods=['POST'])
def clear_history():
    from history_manager import full_clear_history
    # 一次性清空内存树+本地文件+重新加载空数据
    full_clear_history()
    resp = make_response(jsonify({"code": 200, "data": None, "message": "所有图片历史已永久删除"}))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

@app.route('/progress', methods=['GET'])
def get_progress():
    progress_data = task_queue.get_progress()
    return jsonify({"code": 200, "data": progress_data})

if __name__ == '__main__':
    print("=" * 60)
    print("OCR Flask后端服务启动")
    print(f"上传目录: {UPLOAD_FOLDER}")
    print(f"历史存储目录: {HISTORY_ROOT}")
    print("访问地址: http://127.0.0.1:5000")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)