#!/usr/bin/env python3
"""
自动抠图脚本 - 去除图片背景，只保留人物主体
使用 rembg 库（基于 U2-Net AI 模型）

用法:
  python remove_bg.py input.jpg                    # 单张图片，输出为 input_output.png
  python remove_bg.py input1.jpg input2.png        # 批量处理多张图片
  python remove_bg.py --folder ./images            # 处理整个文件夹
  python remove_bg.py photo.jpg -o result.png      # 指定输出文件名
"""

import argparse
import os
import sys
from pathlib import Path

try:
    from rembg import remove
    from PIL import Image
except ImportError:
    print("❌ 缺少依赖，请运行: python3 -m pip install 'rembg[pil]' pillow onnxruntime")
    sys.exit(1)


def process_image(input_path: str, output_path: str = None) -> str:
    """
    处理单张图片，去除背景

    Args:
        input_path: 输入图片路径
        output_path: 输出图片路径（可选）

    Returns:
        输出文件的绝对路径
    """
    input_path = Path(input_path).resolve()

    if not input_path.exists():
        print(f"❌ 文件不存在: {input_path}")
        return None

    # 确定输出路径
    if output_path is None:
        output_path = input_path.with_stem(f"{input_path.stem}_output").with_suffix(".png")
    else:
        output_path = Path(output_path).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"📷 正在处理: {input_path.name}")

    try:
        # 读取图片
        with open(input_path, "rb") as f:
            input_data = f.read()

        # 使用 AI 移除背景（alpha_matting 可获得更精细的边缘）
        output_data = remove(
            input_data,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=10,
        )

        # 保存结果（PNG 格式支持透明通道）
        with open(output_path, "wb") as f:
            f.write(output_data)

        print(f"✅ 已保存到: {output_path}")
        return str(output_path)

    except Exception as e:
        print(f"❌ 处理失败: {e}")
        return None


def process_folder(folder_path: str, recursive: bool = False):
    """
    批量处理文件夹中的所有图片

    Args:
        folder_path: 文件夹路径
        recursive: 是否递归处理子文件夹
    """
    folder = Path(folder_path).resolve()

    if not folder.exists():
        print(f"❌ 文件夹不存在: {folder}")
        return

    # 支持的图片格式
    supported_extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}

    if recursive:
        pattern = "**/*"
    else:
        pattern = "*"

    image_files = [
        f for f in folder.glob(pattern)
        if f.suffix.lower() in supported_extensions and f.is_file()
    ]

    if not image_files:
        print(f"❌ 在 {folder} 中未找到支持的图片文件")
        return

    print(f"📁 发现 {len(image_files)} 张图片\n")
    success_count = 0

    for i, img_file in enumerate(image_files, 1):
        print(f"[{i}/{len(image_files)}]", end=" ")
        result = process_image(str(img_file))
        if result:
            success_count += 1
        print()

    print(f"\n🎉 完成！成功处理 {success_count}/{len(image_files)} 张图片")


def main():
    parser = argparse.ArgumentParser(
        description="AI 自动抠图工具 - 去除图片背景，保留人物主体",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python remove_bg.py photo.jpg                    # 处理单张图片
  python remove_bg.py photo.jpg -o result.png       # 指定输出路径
  python remove_bg.py a.jpg b.jpg c.png            # 批量处理
  python remove_bg.py --folder ./photos             # 处理整个文件夹
  python remove_bg.py --folder ./photos -r          # 递归处理子文件夹
        """,
    )

    parser.add_argument("inputs", nargs="*", help="输入图片文件路径（可多个）")
    parser.add_argument("-o", "--output", help="输出文件路径（仅单张图片时有效）")
    parser.add_argument("--folder", help="处理指定文件夹中的所有图片")
    parser.add_argument(
        "-r", "--recursive", action="store_true", help="递归处理子文件夹"
    )

    args = parser.parse_args()

    # 模式选择
    if args.folder:
        process_folder(args.folder, args.recursive)
    elif args.inputs:
        if len(args.inputs) == 1 and args.output:
            process_image(args.inputs[0], args.output)
        elif len(args.inputs) == 1:
            process_image(args.inputs[0])
        else:
            for img_path in args.inputs:
                process_image(img_path)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
