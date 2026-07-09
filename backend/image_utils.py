import cv2
import numpy as np
import os
from PIL import Image, ImageDraw
from paddleocr import PaddleOCR

HISTORY_ROOT = "history_storage"
BOX_SUB_DIR = os.path.join(HISTORY_ROOT, "boxed_images")
TXT_SUB_DIR = os.path.join(HISTORY_ROOT, "txt_output")
for d in [BOX_SUB_DIR, TXT_SUB_DIR]:
    os.makedirs(d, exist_ok=True)

ocr_engine = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)

class OCRResult:
    def __init__(self):
        self.box_list = []
        self.full_text = ""
        self.box_img_path = ""
        self.txt_path = ""

def run_ocr(img_local_path: str) -> OCRResult:
    res_obj = OCRResult()
    img = cv2.imread(img_local_path)
    if img is None:
        box_name = os.path.basename(img_local_path)
        box_save = os.path.join(BOX_SUB_DIR, box_name)
        cv2.imwrite(box_save, np.zeros((100,100,3), dtype=np.uint8))
        res_obj.box_img_path = box_save
        return res_obj

    ocr_out = ocr_engine.ocr(img_local_path, cls=True)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    draw = ImageDraw.Draw(pil_img)
    line_texts = []

    if ocr_out[0] is not None:
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

    file_name = os.path.basename(img_local_path)
    box_img_full = os.path.join(BOX_SUB_DIR, file_name)
    out_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    cv2.imwrite(box_img_full, out_bgr)
    res_obj.box_img_path = box_img_full

    base_no_ext = os.path.splitext(file_name)[0]
    txt_full = os.path.join(TXT_SUB_DIR, f"{base_no_ext}.txt")
    full_txt = "\n".join(line_texts)
    with open(txt_full, "w", encoding="utf-8") as f:
        f.write(full_txt)
    res_obj.txt_path = txt_full
    res_obj.full_text = full_txt

    return res_obj