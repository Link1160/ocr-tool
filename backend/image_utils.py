import cv2
import numpy as np
import os
import time
from PIL import Image, ImageDraw
from paddleocr import PaddleOCR
from history_manager import BSTHistory

TXT_SAVE_DIR = "ocr_txt_output"
os.makedirs(TXT_SAVE_DIR, exist_ok=True)
ocr_engine = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)

def process_image(img_path):
    img = cv2.imread(img_path)
    if img is None:
        return [], ""
    result = ocr_engine.ocr(img_path, cls=True)
    word_boxes = []
    line_text_list = []
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    draw = ImageDraw.Draw(pil_img)
    if result[0] is None:
        box_img_save_path = os.path.splitext(img_path)[0] + "_boxed.png"
        cv2.imwrite(box_img_save_path, img)
        return word_boxes, ""
    sorted_lines = sorted(result[0], key=lambda x: x[0][0][1])
    for line in sorted_lines:
        coords, (txt, score) = line
        x1, y1 = int(coords[0][0]), int(coords[0][1])
        x2, y2 = int(coords[2][0]), int(coords[2][1])
        word_boxes.append((x1, y1, x2, y2, txt, round(score,2)))
        draw.rectangle([x1, y1, x2, y2], outline=(255, 0, 0), width=2)
        score_text = f"{score:.2f}"
        draw.text((x1, y1 - 8), score_text, fill=(255,0,0))
        line_text_list.append(txt)
    img_fixed = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    box_img_save_path = os.path.splitext(img_path)[0] + "_boxed.png"
    cv2.imwrite(box_img_save_path, img_fixed)
    full_text = "\n".join(line_text_list)
    base_name = os.path.basename(os.path.splitext(img_path)[0])
    txt_path = os.path.join(TXT_SAVE_DIR, f"{base_name}.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(full_text)
    print(f"标注图片已保存：{box_img_save_path}")
    print(f"同排版文本文件已保存：{txt_path}")
    return word_boxes, full_text

if __name__ == "__main__":
    history = BSTHistory()
    test_img = "test.jpg"
    if os.path.exists(test_img):
        stamp = time.time()
        box_data, ocr_text = process_image(test_img)
        # 修正：四个参数对应insert定义
        history.insert(stamp, test_img, ocr_text, box_data)
        print("处理完成，已生成标注图片与TXT，并写入历史记录")
    else:
        print("未找到test.jpg，请将测试图片放到当前目录")
    input("按回车退出...")