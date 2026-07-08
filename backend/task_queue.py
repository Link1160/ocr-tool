import uuid
from collections import deque

# 全局队列和状态字典
task_queue = deque()          # 存储待处理的 task_id
task_status = {}              # 存储每个任务的详细信息

def add_task(file_path):
    """将任务加入队列，返回唯一 task_id"""
    task_id = str(uuid.uuid4())[:8]  # 生成短ID方便看
    task_status[task_id] = {
        "status": "pending",   # pending / doing / done / failed
        "file_path": file_path,
        "result": None,
        "error": None
    }
    task_queue.append(task_id)
    return task_id

def get_next_task():
    """从队列头部取出一个待处理任务ID（先进先出）"""
    if task_queue:
        return task_queue.popleft()
    return None

def update_status(task_id, status, result=None, error=None):
    """更新任务状态"""
    if task_id in task_status:
        task_status[task_id]["status"] = status
        if result is not None:
            task_status[task_id]["result"] = result
        if error is not None:
            task_status[task_id]["error"] = error

def get_task_info(task_id):
    """获取任务详情，前端轮询用"""
    return task_status.get(task_id)

def get_progress():
    """返回队列进度信息（用于前端进度条）"""
    total = len(task_queue) + sum(1 for t in task_status.values() if t["status"] == "done")
    done = sum(1 for t in task_status.values() if t["status"] == "done")
    return {"total": total, "done": done}