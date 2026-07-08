import os
import threading
import time
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

# 导入你自己的模块
import task_queue
import ocr_engine
import image_utils
from history_manager import BSTHistory
from image_utils import crop_image

# ---------- 初始化 Flask ----------
app = Flask(__name__)
CORS(app)  # 解决跨域问题，前端随便请求

bst = BSTHistory()

# ---------- 配置文件 ----------
UPLOAD_FOLDER = 'uploads'
RESULT_FOLDER = 'results'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULT_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 限制50MB


# ---------- 后台工作线程（核心调度） ----------
def worker():
    """
    后台线程：不断从队列取任务，调用OCR识别，更新状态
    """
    # 先加载OCR模型（预热）
    print("正在加载PaddleOCR模型，请稍候...")
    ocr_engine.init_ocr()
    print("OCR模型加载完成，后台工作线程已启动！")

    while True:
        try:
            # 1. 从队列取一个任务
            task_id = task_queue.get_next_task()
            if task_id is None:
                time.sleep(0.5)  # 队列空闲，等待
                continue

            # 2. 更新状态为 doing
            task_info = task_queue.get_task_info(task_id)
            if not task_info:
                continue

            file_path = task_info["file_path"]
            task_queue.update_status(task_id, "doing")

            # 3. 调用OCR识别
            print(f"正在识别任务 {task_id} : {file_path}")
            result_text = ocr_engine.recognize_text(file_path)

            # 4. 判断是否成功
            if "失败" in result_text or not result_text.strip():
                task_queue.update_status(task_id, "failed", error=result_text)
            else:
                task_queue.update_status(task_id, "done", result=result_text)
                # 5. 顺便存入历史记录（BST）
                import datetime
                record = {
                    "id": task_id,
                    "time": str(datetime.datetime.now()),
                    "text": result_text,
                    "image_path": file_path,
                    "file_size": os.path.getsize(file_path)
                }
                bst.insert(time.time(), file_path, result_text)  # 参数：时间戳，图片路径，识别文本

            print(f"任务 {task_id} 处理完成")

        except Exception as e:
            print(f"后台线程出错: {e}")
            if task_id:
                task_queue.update_status(task_id, "failed", error=str(e))
            time.sleep(1)


# 启动后台线程（随Flask服务一起开启）
thread = threading.Thread(target=worker, daemon=True)
thread.start()


# ---------- 路由接口（6个） ----------

@app.route('/upload', methods=['POST'])
def upload_image():
    """接口1：接收图片，加入队列"""
    if 'image' not in request.files:
        return jsonify({"error": "没有图片文件"}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({"error": "文件名为空"}), 400

    # 保存图片到 uploads 文件夹
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
    # 如果重名，加上时间戳防止覆盖
    if os.path.exists(file_path):
        base, ext = os.path.splitext(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{base}_{int(time.time())}{ext}")

    file.save(file_path)

    # 加入队列
    task_id = task_queue.add_task(file_path)

    return jsonify({
        "task_id": task_id,
        "message": "图片上传成功，已加入识别队列"
    }), 200


@app.route('/status/<task_id>', methods=['GET'])
def get_status(task_id):
    """接口2：查询任务状态（前端轮询）"""
    info = task_queue.get_task_info(task_id)
    if not info:
        return jsonify({"error": "任务ID不存在"}), 404

    response = {
        "task_id": task_id,
        "status": info["status"]
    }
    if info["status"] == "done":
        response["result"] = info["result"]
    elif info["status"] == "failed":
        response["error"] = info.get("error", "未知错误")

    return jsonify(response), 200


@app.route('/crop', methods=['POST'])
def crop_and_recognize():
    """接口3：接收裁剪坐标，先裁再识别"""
    data = request.get_json()
    required = ['original_path', 'x1', 'y1', 'x2', 'y2']
    if not all(k in data for k in required):
        return jsonify({"error": "缺少必要参数 (original_path, x1, y1, x2, y2)"}), 400

    # 调用裁剪函数
    cropped_path = image_utils.crop_image(
        data['original_path'],
        data['x1'], data['y1'],
        data['x2'], data['y2']
    )

    # 将裁剪后的图片加入队列
    task_id = task_queue.add_task(cropped_path)
    return jsonify({
        "task_id": task_id,
        "cropped_path": cropped_path,
        "message": "裁剪成功，已加入识别队列"
    }), 200


# ========== 以下三个路由替换掉原来旧的 ==========

@app.route('/history', methods=["GET"])
def get_history():
    data = bst.get_all_history()
    return jsonify({"code": 200, "data": data})


@app.route('/search', methods=["POST"])
def search_history():
    key = request.json.get("keyword")
    result = bst.search_by_keyword(key)
    return jsonify({"code": 200, "data": result})


@app.route("/crop", methods=["POST"])
def crop_pic():
    data = request.get_json()
    origin = data["path"]
    x1 = data["x1"]
    y1 = data["y1"]
    x2 = data["x2"]
    y2 = data["y2"]

    # 优化：用时间戳命名，防止覆盖
    import time as t
    new_path = f"uploads/crop_{int(t.time())}.jpg"

    # 注意：这里 crop_image 的参数顺序要和 image_utils.py 里保持一致
    crop_image(origin, new_path, x1, y1, x2, y2)

    return jsonify({"new_img_path": new_path})


@app.route('/export/<task_id>', methods=['GET'])
def export_result(task_id):
    """接口6：导出识别结果为txt文件"""
    info = task_queue.get_task_info(task_id)
    if not info:
        return jsonify({"error": "任务不存在"}), 404

    if info["status"] != "done":
        return jsonify({"error": "该任务尚未完成识别"}), 400

    text = info.get("result", "")
    if not text:
        return jsonify({"error": "识别结果为空"}), 400

    # 保存到 results 文件夹
    file_path = os.path.join(RESULT_FOLDER, f"{task_id}.txt")
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(text)

    # 返回文件供下载
    return send_file(file_path, as_attachment=True, download_name=f"{task_id}_识别结果.txt")


@app.route('/clear_history', methods=['POST'])  # 额外彩蛋接口
def clear_history():
    """清空历史记录（彩蛋功能）"""
    # 注意：这里占位清空，等组员B实现BST的clear方法
    global history_manager
    # 简单处理：重新初始化（仅占位，组员B会完善）
    return jsonify({"message": "历史记录已清空"}), 200


@app.route('/progress', methods=['GET'])  # 额外彩蛋接口
def get_progress():
    """获取队列进度（供前端进度条使用）"""
    return jsonify(task_queue.get_progress()), 200


@app.route('/ping', methods=['GET'])
def ping():
    """健康检查"""
    return jsonify({"status": "ok", "message": "Flask服务运行中"})


# ---------- 启动服务 ----------
if __name__ == '__main__':
    print("=" * 50)
    print("🚀 本地OCR后端服务启动中...")
    print(f"📁 上传目录: {UPLOAD_FOLDER}")
    print(f"📁 结果目录: {RESULT_FOLDER}")
    print("🌐 访问地址: http://127.0.0.1:5000")
    print("=" * 50)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)

    @app.route('/')
    def home():
        return jsonify({
            "message": "🎯 OCR后端服务运行正常！",
            "可用接口": [
                "/ping - 健康检查",
                "/upload - 上传图片",
                "/status/<task_id> - 查询状态",
                "/history - 查看历史"
            ]
        }), 200

