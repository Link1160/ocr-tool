import uuid
from collections import deque

task_queue = deque()
task_status = {}

def add_task(file_path):
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
    if task_queue:
        return task_queue.popleft()
    return None

def update_status(task_id, status, result=None, error=None, box_img_url=None, original_img_url=None):
    if task_id in task_status:
        task_status[task_id]["status"] = status
        if result is not None:
            task_status[task_id]["result"] = result
        if error is not None:
            task_status[task_id]["error"] = error
        if box_img_url is not None:
            task_status[task_id]["box_img_url"] = box_img_url
        # 修复：补上赋值
        if original_img_url is not None:
            task_status[task_id]["original_img_url"] = original_img_url

def get_task_info(task_id):
    return task_status.get(task_id)

def get_progress():
    total = len(task_queue) + sum(1 for t in task_status.values() if t["status"] == "done")
    done = sum(1 for t in task_status.values() if t["status"] == "done")
    return {"total": total, "done": done}