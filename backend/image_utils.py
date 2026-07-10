# ============== 顶部环境变量，禁用OneDNN + PIR执行器 ==============
import os
import sys

os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_use_mkldnn_int8"] = "0"
os.environ["FLAGS_use_onednn"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"
os.environ["FLAGS_use_pir_inference"] = "0"
os.environ["FLAGS_new_executor"] = "0"

# 开发环境基准目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)

import cv2
import numpy as np
import time
from PIL import Image, ImageDraw
from paddleocr import PaddleOCR
# 复用全局路径常量，保证目录统一
from history_manager import HISTORY_ROOT, BOX_SUB_DIR, TXT_SUB_DIR

# 自动创建存储目录
for d in [BOX_SUB_DIR, TXT_SUB_DIR]:
    os.makedirs(d, exist_ok=True)

# 初始化OCR引擎
ocr_engine = PaddleOCR(use_angle_cls=True, lang="ch")


class OCRResult:
    def __init__(self):
        self.box_list = []
        self.full_text = ""
        self.box_img_path = ""
        self.txt_path = ""


# ========== 中文路径兼容工具函数 ==========
def cv_read_image(file_path):
    """兼容中文路径的图片读取，替代cv2.imread"""
    if not os.path.exists(file_path):
        return None
    # 从文件读取字节流，再解码为图片，完全规避路径编码问题
    img_array = np.fromfile(file_path, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    return img


def cv_write_image(save_path, img):
    """兼容中文路径的图片保存，替代cv2.imwrite"""
    # 获取文件扩展名，自动适配jpg/png等格式
    ext = os.path.splitext(save_path)[1]
    # 编码图片后写入文件，规避路径编码问题
    cv2.imencode(ext, img)[1].tofile(save_path)
    return save_path


def run_ocr(img_local_path: str) -> OCRResult:
    res_obj = OCRResult()
    # 使用兼容中文的方式读取图片
    img = cv_read_image(img_local_path)

    if img is None:
        box_name = os.path.basename(img_local_path)
        box_save = os.path.join(BOX_SUB_DIR, box_name)
        cv_write_image(box_save, np.zeros((100, 100, 3), dtype=np.uint8))
        res_obj.box_img_path = box_save
        return res_obj

    # 直接传入图片数组给PaddleOCR，避免内部二次读取路径触发中文问题
    ocr_out = ocr_engine.ocr(img)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    draw = ImageDraw.Draw(pil_img)
    line_texts = []

    if ocr_out[0] is not None:
        # 按纵向坐标排序，保证阅读顺序
        sorted_lines = sorted(ocr_out[0], key=lambda x: x[0][0][1])
        for line in sorted_lines:
            coords, (txt, score) = line
            x1 = int(coords[0][0])
            y1 = int(coords[0][1])
            x2 = int(coords[2][0])
            y2 = int(coords[2][1])
            res_obj.box_list.append({
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "text": txt, "score": round(score, 2)
            })
            draw.rectangle([x1, y1, x2, y2], outline=(0, 255, 0), width=2)
            draw.text((x1, y1 - 16), f"{score:.2f}", fill=(0, 255, 0))
            line_texts.append(txt)

    # 保存标注图（兼容中文路径）
    file_name = os.path.basename(img_local_path)
    box_img_full = os.path.join(BOX_SUB_DIR, file_name)
    out_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    cv_write_image(box_img_full, out_bgr)
    res_obj.box_img_path = box_img_full

    # 保存识别文本TXT
    base_no_ext = os.path.splitext(file_name)[0]
    txt_full = os.path.join(TXT_SUB_DIR, f"{base_no_ext}.txt")
    full_txt = "\n".join(line_texts)
    with open(txt_full, "w", encoding="utf-8") as f:
        f.write(full_txt)
    res_obj.txt_path = txt_full
    res_obj.full_text = full_txt

    return res_obj


def crop_image(origin_path, save_path, x1, y1, x2, y2):
    img = Image.open(origin_path)
    cropped = img.crop((int(x1), int(y1), int(x2), int(y2)))
    cropped.save(save_path)
    return save_path


if __name__ == "__main__":
    from history_manager import BSTHistory

    history = BSTHistory()
    test_img = "test.jpg"
    if os.path.exists(test_img):
        stamp = time.time()
        ocr_res = run_ocr(test_img)
        box_data = ocr_res.box_list
        ocr_text = ocr_res.full_text
        history.insert(stamp, test_img, ocr_text, box_data)
        print("处理完成，已生成标注图片与TXT，并写入历史记录")
    else:
        print("未找到test.jpg，请将测试图片放到当前目录")
    input("按回车退出...")