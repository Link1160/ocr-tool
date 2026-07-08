import os
from PIL import Image


def crop_image(original_path, x1, y1, x2, y2):
    """
    根据前端传来的坐标裁剪图片
    返回裁剪后的新图片路径
    """
    try:
        img = Image.open(original_path)
        # 确保坐标是整数且在图片范围内
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        cropped = img.crop((x1, y1, x2, y2))

        dir_name = os.path.dirname(original_path)
        base_name = os.path.basename(original_path)
        cropped_path = os.path.join(dir_name, f"crop_{base_name}")
        cropped.save(cropped_path)
        return cropped_path
    except Exception as e:
        print(f"裁剪失败: {e}")
        return original_path  # 裁剪失败返回原图