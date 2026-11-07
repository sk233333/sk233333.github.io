---
title: "YOLOv8 训练实战：从自己标注的数据集到可部署的检测模型"
published: 2026-11-07
description: "一条命令跑通数据检查、训练、验证、推理与导出；data.yaml 怎么写、标签为什么必须归一化、workers 为什么把 IDE 跑崩、mAP 低了该看哪几个数，每个问题都给现象、原因和验证方法。"
image: "/image/yolov8-guide/cover.png"
category: "目标检测"
draft: false
tags: [YOLOv8, Ultralytics, 数据集训练, 目标检测, mAP, PyTorch, 模型导出]
---

# 从「自己标注的数据集」到「能跑起来的 YOLOv8 模型」

> **一句话结论：先把 data.yaml 和标签格式用检查脚本过一遍，再谈调参；八成“训练没效果”都是目录结构、类别号、标签坐标三者之一错了。**
>
> YOLOv8 的训练本身只有一条命令，真正花时间的是让数据集被正确识别。
> 这篇文章按“数据 → 训练 → 评估 → 推理 → 导出”的顺序走，每一步都给出可验证的判据。

**读完你会得到：**

- 30 秒判断数据集能不能被 Ultralytics 认出来
- 一份可以直接改的 `data.yaml` 和标签格式说明
- 训练参数怎么填：epochs、batch、imgsz、workers 的实际影响
- 怎么用 mAP 和分类别指标判断模型是否真的有用
- 一张「症状 → 真正原因」的速查表

---

## 目录

- [0. 环境与依赖](#env)
- [1. 最短路径：五条命令跑通](#quick)
- [2. 数据集：目录结构与 data.yaml](#data)
- [3. 标签格式：一行一个框](#label)
- [4. 训练](#train)
- [5. 进阶：改结构和换检测头](#custom)
- [6. 评估：mAP 到底看哪个](#eval)
- [7. 推理、可视化与导出](#infer)
- [8. 症状速查表](#trouble)
- [9. 验收清单与排查顺序](#accept)
- [附录｜数据集自检脚本](#diag)

---

<a id="env"></a>
## 0. 环境与依赖

| 用途 | 依赖 | 装法 |
|---|---|---|
| 训练、验证、导出 | ultralytics | `pip install ultralytics` |
| 计算后端 | torch、torchvision | 按显卡版本从官网装，别直接 `pip install torch` |
| 画图与统计 | matplotlib、numpy | `pip install matplotlib numpy` |
| 数据集描述文件 | pyyaml | `pip install pyyaml` |

本文所有命令在下面这套环境实测跑通：

```
Python 3.10 · PyTorch 2.11 (CUDA 12.8) · Ultralytics 8.4.183
RTX 4060 Laptop 8 GB，训练显存峰值约 3.4 GB，主机内存峰值约 2.5 GB
```

先确认框架能加载模型，再往下走：

```bash
python3 -c "from ultralytics import YOLO; m = YOLO('yolov8n.pt'); print(m.names[0])"
```

能打印出 `person` 就说明权重能下载、CUDA 能调用。如果卡在下载，先把 `yolov8n.pt` 放到工作目录里。

> **显存提醒**：`yolov8n` 在 640 分辨率、batch=8 下只占 3 到 4 GB，8 GB 显卡够用；换成 `yolov8m` 以上先把 batch 降到 4 或 2。

---

<a id="quick"></a>
## 1. 最短路径：五条命令跑通

假设原始数据已经按 `images/ + labels/` 组织好，放在 `Data/{train,valid,test}/`：

```bash
# 1) 抽样构建训练集子集，同时生成 data.yaml
python3 scripts/prepare_dataset.py --source Data --train 1600 --val 400 --test 400

# 2) 训练
python3 src/train.py --variant baseline --epochs 30 --imgsz 640 --batch 8 --device 0

# 3) 在测试集上验证
python3 src/evaluate.py --variant baseline --weights results/runs/baseline/weights/best.pt --split test

# 4) 跑一张图看效果
python3 scripts/predict_samples.py --variant baseline --source samples --limit 4

# 5) 导出 ONNX
yolo export model=results/runs/baseline/weights/best.pt format=onnx opset=12 imgsz=640
```

用官方命令行等价写法，不依赖仓库脚本也行：

```bash
yolo detect train data=datasets/mydata/data.yaml model=yolov8n.pt epochs=30 imgsz=640 batch=8
yolo detect val model=runs/detect/train/weights/best.pt data=datasets/mydata/data.yaml split=test
```

两条路径的区别只有一个：仓库脚本包了一层 Trainer，用来注入自定义模块（第 5 节）。

---

<a id="data"></a>
## 2. 数据集：目录结构与 data.yaml

Ultralytics 对目录的要求很死板：**图片和标签分两个平行目录，文件名主干必须一一对应**。

```
datasets/mydata/
├── data.yaml
├── train/
│   ├── images/  a.jpg  b.jpg ...
│   └── labels/  a.txt  b.txt ...
├── val/
│   ├── images/
│   └── labels/
└── test/            # 可选，但评估要它
    ├── images/
    └── labels/
```

`data.yaml` 只有四个关键字段：

```yaml
path: /abs/path/datasets/mydata    # 数据集根目录
train: train/images
val: val/images
test: test/images
nc: 2
names:
  0: fire
  1: smoke
```

| 字段 | 坑点 |
|---|---|
| `path` | 写成绝对路径，换机器立刻报 `Dataset not found`；改成相对路径或重跑构建脚本 |
| `train/val/test` | 写相对 `path` 的子路径，别写绝对路径 |
| `nc` | 必须等于 `names` 的条目数，不等会在训练第一个 epoch 前报错 |
| `names` | 顺序即类别号，`0` 对应标签文件里写的 `0`；这里错了，模型会把火当烟 |

类别号还有一种更隐蔽的错法：**names 写对了，但标注工具导出时类别从 1 开始编号**。结果是 `nc: 2` 却有 `2` 号类别，训练日志里会出现大量 `ignoring label class 2`，直接静默丢框。

本文实验用的子集规模如下，可以当作“小规模验证”的参考量级：

| 划分 | 图像数 | fire 框 | smoke 框 |
|---|---|---|---|
| train | 1600 | 1992 | 1787 |
| val | 400 | 815 | 302 |
| test | 400 | 658 | 241 |
| 合计 | 2400 | 3465 | 2330 |

面积小于整图 0.3% 的目标占 10.3%，这是后面“小目标召回上不去”的根本原因，不是调参能解决的。

> **抽样时别只按文件数抽**。按比例分层抽样才能保证 val 里的类别分布和 train 接近，否则 val 的 mAP 波动会非常大。

---

<a id="label"></a>
## 3. 标签格式：一行一个框

每个 `.txt` 对应一张图，一行一个目标，格式固定为五个数：

```
类别号  中心x  中心y  宽  高
```

后四个都是**归一化到 0 到 1 的相对值**（除以图片宽高），不是像素坐标，也不是左上右下角点。

```
0 0.5123 0.4471 0.2210 0.1834
1 0.3310 0.6022 0.1500 0.2210
```

四个最容易犯的错：

| 错法 | 后果 | 怎么发现 |
|---|---|---|
| 写了像素坐标（如 `320 240 100 80`） | 框全部超出图像，训练时被裁成整图或直接丢弃 | 检查脚本会报 `out of range` |
| 写了 `x1 y1 x2 y2` 角点格式 | 框位置整体偏移、尺寸翻倍 | 画出来看，框会系统性错位 |
| 类别从 1 开始 | 最高类别号等于 `nc`，该类别全部丢框 | 日志 `ignoring label class` |
| 负样本没建空 txt | 该图被当成“未标注”而跳过 | 统计 labels 文件数比 images 少 |

**负样本要建空文件**：一张纯背景图，也要有同名的空 `.txt`，这样才能作为负样本参与训练。没有文件等于这张图不存在。

---

<a id="train"></a>
## 4. 训练

```bash
python3 src/train.py --variant baseline --epochs 30 --imgsz 640 --batch 8 --workers 2 --device 0
```

| 参数 | 本项目取值 | 说明 |
|---|---|---|
| `epochs` | 30 | 小数据集 30 轮够看趋势；正式训练建议 100 以上配合 `patience` 早停 |
| `imgsz` | 640 | YOLOv8 默认尺度；小目标多可上 960，显存和耗时同步上涨 |
| `batch` | 8 | 8 GB 显存的安全值，`yolov8n` 可上 16 |
| `workers` | 0 到 2 | 见下方内存坑 |
| `device` | `0` | 只有 CPU 时写 `cpu` |
| `cos_lr` | 开 | 余弦退火，末段学习率降下来更稳 |
| `amp` | 开 | 混合精度，省显存约三成 |
| `deterministic` | 开 | 固定种子后可复现，代价是略慢 |

训练开始后先看三行日志：

```
train: Scanning ... 1600 images, 3779 backgrounds
val:   Scanning ... 400 images,  ...
```

`images` 数对不上就是目录或后缀问题；`backgrounds` 数异常大就是标签文件名没对上。

### workers 为什么把 IDE 一起跑崩

在 14 GB 内存、无 swap 的机器上，`workers=2` 叠加 IDE 会触发系统级 OOM，进程被 `kill -9`，表现是“训练跑到一半 IDE 突然消失”。

- 内存紧张：`workers=0`，数据加载在主进程里，慢一点但不会连坐
- 训练中不画图：`plots=False`，训练曲线图很吃内存
- 长任务放后台：`nohup ... &`，别绑在 IDE 的终端上

### CUDA 报错别急着改代码

`CUDA error: 304` 这类初始化失败，九成是上一次进程没退干净、显存没释放。本项目用一层“失败重试”包住单次训练：

```bash
for attempt in 1 2 3; do
  python3 src/train.py --variant "$1" && break
  sleep 5
done
```

连续三次都失败，再去查驱动和显存占用。

---

<a id="custom"></a>
## 5. 进阶：改结构和换检测头

不满足于官方配置时，不要改 Ultralytics 源码，用 Trainer 子类覆写 `get_model` 即可。

```python
from ultralytics.models.yolo.detect import DetectionTrainer

class MyTrainer(DetectionTrainer):
    inject = True

    def get_model(self, cfg=None, weights=None, verbose=True):
        model = super().get_model(cfg=cfg, weights=weights, verbose=verbose)
        if self.inject:
            inject_my_module(model)      # 在这里改结构
        return model
```

`model.model` 是一个 `nn.Sequential`，按下标替换某一层就能插入模块：

```python
layers[i] = Wrapped(layers[i])   # 包裹式注入，不改前向语义
```

两处真实改动，效果和代价都摆在这里：

| 变体 | 改动 | 参数量 | GFLOPs | mAP50 | 说明 |
|---|---|---|---|---|---|
| baseline | 无 | 3.13 M | 8.60 | 48.72% | 对照组 |
| +CBAM | 6 个 C2f 后接通道—空间注意力 | 3.16 M | 8.60 | 48.53% | 召回 39.66→44.62%，漏检明显减少 |
| +P2 | 颈部增加 160×160 检测分支 | 2.92 M | 12.20 | 43.89% | 小目标召回略升，精度下降 |
| 完整 | 两者叠加 | 2.94 M | 12.20 | 45.42% | 召回最高，mAP 仍低于基线 |

这张表要说明的是：**结构改进不一定涨点**。30 轮、2400 张的小规模实验里，注意力和小目标分支的收益被数据量限制住了；如实报告负增益，比只挑好看的数写进论文更有说服力。

改结构后必须重新训练，**不要试图加载旧权重的全部参数**——层数变了，官方权重只能部分匹配，`load()` 会跳过错位的层。

---

<a id="eval"></a>
## 6. 评估：mAP 到底看哪个

```bash
python3 src/evaluate.py --variant full --weights results/runs/full/weights/best.pt --split test
```

输出是一份 JSON，关键字段：

| 字段 | 含义 | 怎么用 |
|---|---|---|
| `mAP50` | IoU=0.5 时的平均精度 | 先看它，能到 0.5 说明基本可用 |
| `mAP50-95` | IoU 0.5 到 0.95 平均 | 衡量框的贴合度，通常只有 mAP50 的一半 |
| `precision` | 报出来的框有多少是对的 | 误报多就低 |
| `recall` | 真实目标有多少被找到 | 漏检多就低 |
| `per_class` | 分类别指标 | 判断是单一类别拖后腿还是整体弱 |
| `speed_ms_per_image` | 预处理/推理/后处理耗时 | 部署时按总耗时算 FPS |

两个口径必须说清楚，否则数字会自相矛盾：

- **前向推理耗时**：只有网络 forward
- **单帧总耗时**：预处理 + forward + NMS 后处理

用前向量除以 FPS 会得到一个偏高的值。本项目的 `fps` 一律按**总耗时**折算（完整模型 6.75 ms → 148 FPS），表格里也标注了口径。

还有一个常被忽略的点：**mAP 低于基线不等于模型坏了**。先看分类别指标——如果只有 smoke 掉、fire 涨，那是类别本身难（烟雾无固定形状、边界模糊），不是训练出错。

---

<a id="infer"></a>
## 7. 推理、可视化与导出

```bash
# 批量跑一个目录，输出带框图片
python3 scripts/predict_samples.py --variant full --source samples --limit 4

# 单图直接看
yolo predict model=results/runs/full/weights/best.pt source=test.jpg conf=0.25 iou=0.45

# 导出 ONNX（部署最通用）
yolo export model=results/runs/full/weights/best.pt format=onnx opset=12 imgsz=640

# 导出 TensorRT（同显卡上最快）
yolo export model=results/runs/full/weights/best.pt format=engine half=True imgsz=640
```

推理阈值有两个，别混：

- `conf`：置信度低于它的框直接丢
- `iou`：NMS 时两个框重叠超过它就算重复

监控场景建议 `conf=0.25`、`iou=0.45`；要严格控制误报就把 `conf` 提到 0.4 以上，代价是漏检增加。

### 视频流：别每帧都推理

25 fps 全帧推理没必要，也很浪费。按 5 fps 抽帧 + 多帧确认即可：

```
连续 K 帧中至少有 K_min 帧命中（且框位置 IoU ≥ 0.5）才触发告警
```

单帧误检会被这层时序过滤掉，这是工程上比调参更有效的降误报手段。

---

<a id="trouble"></a>
## 8. 症状速查表

| 你看到的现象 | 真正原因 | 解法 |
|---|---|---|
| `Dataset not found` | `data.yaml` 里 `path` 是旧机器的绝对路径 | 改相对路径或重跑构建脚本 |
| 训练日志 `0 images` | 目录层级不对（多套了一层）或后缀不认 | 确认是 `train/images/*.jpg` |
| `ignoring label class 2` | 类别号从 1 开始，或 `nc` 写小了 | 标注改回 0 起，或改 `nc` |
| 损失一直不降 | 标签坐标不是归一化值 | 用检查脚本查 `out of range` |
| mAP 恒为 0 | 标签与图片文件主名不一致 | 逐对核对 stem |
| 框位置整体偏移 | 标签写成了角点格式 | 转成中心点 + 宽高 |
| 训练中 IDE 突然消失 | workers 导致系统 OOM | `workers=0`、`plots=False` |
| `CUDA error: 304` | 显存没释放 / 进程残留 | 重试或重启，查 `nvidia-smi` |
| 显存不够 | batch 或 imgsz 太大 | batch 减半，或换 `yolov8n` |
| val 的 mAP 抖动很大 | val 太小或类别分布偏 | 加大 val，改分层抽样 |
| smoke 指标明显差于 fire | 烟雾边界模糊、样本少 | 补样本，或用更高分辨率 |
| 训练涨点、测试掉点 | 过拟合或测试集分布不同 | 加数据增强、看早停轮次 |
| 导出 ONNX 报动态形状错误 | opset 太低 | `opset=12` 或更高 |
| 部署后结果和 PyTorch 不一致 | 预处理不一致（letterbox、BGR/RGB） | 对齐归一化和通道顺序 |

---

<a id="accept"></a>
## 9. 验收清单与排查顺序

### 训练前

```
① data.yaml 的 path 能在当前机器打开吗？     → 打不开就是路径问题
② 三个 split 的图像数对不对？               → 对不上查目录层级
③ 标签坐标都在 0~1 之间吗？                 → 不在就是没归一化
④ 类别号最大值 = nc - 1 吗？                → 超了就是编号从 1 开始
⑤ 负样本有空 txt 吗？                       → 没建会被当不存在
```

### 训练后

```
① best.pt 能加载并在测试集跑出非零 mAP 吗？
② 分类别指标里有没有某一类特别低？
③ 抽 4 张图看框的位置是否贴合目标？
④ 耗时口径有没有写清（前向 vs 总耗时）？
```

### 排查顺序（照这个来，不迷路）

```
路径与目录结构  →  标签格式与类别号  →  抽样与类别分布
      ↓
显存与 workers  →  训练轮次是否足够  →  分类别指标定位弱类
      ↓
推理阈值与预处理对齐  →  导出与部署差异（最后再查）
```

---

<a id="diag"></a>
## 附录｜数据集自检脚本

在训练前跑一次，能把上面九成的数据集问题挡在门外：

```bash
python3 - <<'PY'
import yaml, pathlib
from collections import Counter

root = pathlib.Path("datasets/mydata")
cfg = yaml.safe_load(open(root / "data.yaml"))
nc = cfg["nc"]
print("类别:", cfg["names"], "nc =", nc)

for split in ("train", "val", "test"):
    img_dir = root / cfg[split]
    lbl_dir = img_dir.parent / "labels"
    imgs = {p.stem for p in img_dir.glob("*") if p.suffix.lower() in {".jpg", ".png", ".jpeg"}}
    lbls = {p.stem for p in lbl_dir.glob("*.txt")}
    missing = imgs - lbls
    counts, bad = Counter(), 0
    for stem in imgs & lbls:
        for line in (lbl_dir / f"{stem}.txt").read_text().splitlines():
            if not line.strip():
                continue
            parts = line.split()
            cls = int(parts[0])
            vals = [float(v) for v in parts[1:5]]
            counts[cls] += 1
            if cls >= nc or any(v < 0 or v > 1 for v in vals):
                bad += 1
    print(f"{split}: {len(imgs)} 图 / {len(lbls)} 标签, 缺标签 {len(missing)}, 非法行 {bad}, 框数 {dict(counts)}")
PY
```

三行里任何一个数不对，都先修数据集再训练：

- `缺标签` 不为 0：有些图没有空 txt 或缺标注
- `非法行` 不为 0：坐标没归一化或类别号超范围
- `框数` 里出现 `nc` 及以上的键：类别编号从 1 开始在作怪
