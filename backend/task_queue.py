import uuid
from collections import deque

# 全局任务队列与状态字典
task_queue = deque()
task_status = {}

def add_task(file_path):
    """新增任务到队列，返回任务ID"""
    task_id = str(uuid.uuid4())[:8]
    task_status[task_id] = {
        "status": "pending",
        "file_path": file_path,
        "result": None,
        "error": None,
        "box_img_url": None,
        "original_img_url": None
    }
    task_queue.append(task_id)
    return task_id

def get_next_task():
    """取出下一个待处理任务"""
    if task_queue:
        return task_queue.popleft()
    return None

def update_status(task_id, status, result=None, error=None, box_img_url=None, original_img_url=None):
    """更新任务状态【修复：补上original_img_url赋值】"""
    if task_id in task_status:
        task_status[task_id]["status"] = status
        if result is not None:
            task_status[task_id]["result"] = result
        if error is not None:
            task_status[task_id]["error"] = error
        if box_img_url is not None:
            task_status[task_id]["box_img_url"] = box_img_url
        if original_img_url is not None:
            task_status[task_id]["original_img_url"] = original_img_url

def get_task_info(task_id):
    """获取任务详情"""
    return task_status.get(task_id)

def get_progress():
    """获取任务处理进度"""
    total = len(task_queue) + sum(1 for t in task_status.values() if t["status"] == "done")
    done = sum(1 for t in task_status.values() if t["status"] == "done")
    return {"total": total, "done": done}