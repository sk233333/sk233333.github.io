---
title: "ROS2 差速小车建图导航：从地图扭曲到点云与墙完全重合"
published: 2026-10-24
description: "Gazebo + slam_toolbox + Nav2 实录：12 个坑逐一拆解——地图变形、锯齿墙、误闭环、位姿瞬移、map→odom 差 5 米、EKF 抢 TF、扫描匹配关掉后墙变厚。每个坑都给现象、根因、定位命令和验证标准。"
image: "/image/nav2-0/car1.jpg"
category: "ROS2学习日常"
draft: false
tags: [ROS2, GAZEBO, SLAM, NAV2, slam_toolbox, 建图, 导航, 里程计标定, robot_localization, EKF]
---

# 从"建出来的图和实际完全对不上"到"点云与墙完全重合"

> **一句话结论：地图不对，先怀疑里程计，再怀疑 SLAM。**
>
> 这篇文章记录我用 **Gazebo 11 + ROS2 Humble + slam_toolbox + Nav2** 建图导航时踩过的 12 个坑。
> 我一开始一直在调 SLAM 参数（闭环门槛、扫描阈值），越调越乱；直到把 `wheel_separation` 修对、把里程计标定完，问题才一次性全部消失。

**读完你会得到：**

- 一张"症状 → 最可能原因"的速查表，遇到问题 30 秒能定位方向
- 每个坑的定量分析（为什么会这样、错多少、误差怎么算）
- 可直接抄的配置、脚本和验证命令
- 一条不会迷路的排查顺序

---

## 目录

- [12 个坑速览](#坑速览)
- [0. 环境确认](#env)
- [1. 机器人模型：三个必看点](#model)
- [2. 坑 1｜控制器参数与 URDF 不一致](#pit1)
- [3. 坑 2｜运动畸变：锯齿墙](#pit2)
- [4. 坑 3｜误闭环：车"瞬移"到隔壁房间](#pit3)
- [5. 坑 4｜建图快完成时崩溃](#pit4)
- [6. 坑 5｜拿不到 Gazebo 真值：插件类型错了](#pit5)
- [7. 坑 6｜里程计标定（核心）](#pit6)
- [8. 坑 7｜`map→odom` 硬编码成 0，导航差 5 米](#pit7)
- [9. 坑 8、9｜Nav2 启动失败的两个经典错误](#pit8)
- [10. 补坑 10～12｜仿真是"太干净"也是坑](#pit10)
- [11. 完整启动流程](#flow)
- [12. 容易忽略的细节清单](#details)
- [13. 排查顺序](#order)
- [附录｜一键诊断脚本](#diag)

---

<a id="坑速览"></a>
## 12 个坑速览（原 9 个 + 后来补的 3 个）

| # | 现象 | 真正原因 | 一句话解法 |
|---|---|---|---|
| 1 | 地图变形、墙不闭合、房间拼不成直角 | `wheel_separation` 与 URDF 不一致（0.34 vs 0.26，差 31%） | 改成 0.26 |
| 2 | 墙是锯齿状、双层描边 | 运动畸变：雷达 10 Hz，转弯 0.8 rad/s，一帧内车转了 4.6° | turn 降到 0.20 |
| 3 | 车在左房间，地图上突然定位到右房间 | 误闭环，响应门槛 `0.1` 太低 | 提到 0.50 / 0.60 |
| 4 | 建图"快完成时就崩" | 资源累积到临界点 + 闭环优化瞬时峰值 | 关 GUI + 定时存图 |
| 5 | 拿不到 Gazebo 真值话题 | `libgazebo_ros_state.so` 是 WorldPlugin，不能用 `-s` 加载 | 写进 world 文件 |
| 6 | 车一转点云就扭曲 | 里程计不准（转弯角度算错） | 用 multiplier 标定 |
| 7 | 导航时车在地图上差 5 米 | `map→odom` 被硬编码成 0 | 填实测值（yaw 用弧度） |
| 8 | `Transition is not registered` | 上次的 Nav2 没杀干净，节点重复 | 精确 kill Nav2 |
| 9 | `Node not recognized: RecoveryNode` | BT 插件清单缺项 | 同步官方 `plugin_lib_names` |
| **10** | **slam 位姿周期性跳 7 米，地图忽大忽小** | **`odom→base_footprint` 有两个发布者** | **开 EKF 时关掉控制器的 odom TF** |
| **11** | **墙被画厚，占据率翻倍（15.4% vs 5.5%）** | **`use_scan_matching: false`** | **在有里程计误差时必须打开** |
| **12** | **机器人在地图上"消失"、Nav2 报 `frame does not exist`** | **两套 nav2 / 两套 odom 同时跑** | **同一时刻只留一套** |

---

<a id="env"></a>
## 0. 环境确认

```bash
ros2 topic list
```

能正常输出（哪怕空列表）说明 ROS2 环境生效。我用的组合是 **Humble + Gazebo 11（classic）**。

```bash
# 关键包自检
ros2 pkg list | grep -E "slam_toolbox|nav2_bringup|gazebo_ros2_control|diff_drive_controller|robot_localization"
```

缺哪个装哪个：

```bash
sudo apt install -y ros-humble-slam-toolbox \
                    ros-humble-nav2-bringup \
                    ros-humble-gazebo-ros2-control \
                    ros-humble-ros2-controllers \
                    ros-humble-robot-localization
```

> 注意：ROS2 的很多"DDS 抽风"其实是发现不稳。本机调试可以加
> `export ROS_LOCALHOST_ONLY=1`，少一半莫名其妙的问题。

---

<a id="model"></a>
## 1. 机器人模型（xacro）：三个必看点

### ① 雷达不要加 `collision`

```xml
<link name="lidar_link">
  <visual>
    <geometry><cylinder radius="0.03" length="0.04"/></geometry>
  </visual>
  <!-- ★ 关键：不加 collision，否则激光射线打到自己，/scan 全是 0.12 米 -->
</link>
```

**如果 `/scan` 全是近距离值，第一件事就查这里。**

### ② `rpy="0 0 0"` 保证扫描平面水平

```xml
<joint name="lidar_joint" type="fixed">
  <parent link="base_link"/>
  <child  link="lidar_link"/>
  <!-- 世界 z = 0.05 + 0.11 = 0.16，rpy=0 保证扫描面水平 -->
  <origin xyz="0.10 0 0.11" rpy="0 0 0"/>
</joint>
```

rpy 不为 0，扫描面会倾斜，打到地面或天花板，地图上会莫名多出一圈障碍。

### ③ Gazebo 插件必须放在 `</robot>` 之前

```xml
<gazebo>
  <plugin filename="libgazebo_ros2_control.so" name="gazebo_ros2_control">
    <robotNamespace>/</robotNamespace>
    <robot_param>robot_description</robot_param>
    <robot_param_node>robot_state_publisher_node</robot_param_node>
    <parameters>$(find my_robot_description)/config/robot_controllers.yaml</parameters>
  </plugin>
</gazebo>
```

放错位置插件不加载，控制器永远起不来。

### 轮距与轮半径（后面标定的基准）

```xml
<xacro:property name="wheel_radius"     value="0.05"/>
<xacro:property name="wheel_separation" value="0.26"/>
```

驱动轮 joint 的 y 偏移是 `${reflect * wheel_separation/2}`，所以左轮 y=+0.13、右轮 y=−0.13，**轮距 = 0.26**。

---

<a id="pit1"></a>
## 2. 坑 1｜控制器参数与 URDF 不一致 —— 地图变形的元凶 ⭐⭐⭐

### 现象

墙拼不成直角、房间是梯形、绕一圈首尾对不上，出现双线重影。

### 30 秒定位

```bash
grep -E "wheel_separation|wheel_radius" \
  ~/robot_ws/src/my_robot_description/urdf/robot.urdf.xacro
grep -E "wheel_separation|wheel_radius" \
  ~/robot_ws/install/my_robot_description/share/my_robot_description/config/robot_controllers.yaml
```

我当时的值：

| 参数 | URDF | yaml | 偏差 |
|---|---|---|---|
| `wheel_radius` | 0.05 | 0.05 | ✅ |
| **`wheel_separation`** | **0.26** | **0.34** | ❌ **差 31%** |

**0.34 是旧模型的轮距**（旧轮子在 y=±0.17）。模型改了，控制器忘了同步。

### 为什么会毁掉地图

差速车的转角是靠轮距算出来的：

```
转过的角度 θ = (右轮位移 − 左轮位移) / 轮距
                                      ↑
                        这里用的是 0.34，真实是 0.26
```

车实际转 100°，里程计只记 **76.5°**（0.26 ÷ 0.34）。

| 后果 | 表现 |
|---|---|
| 转弯角度系统性偏小 | 每个弯都"欠转"，误差累积 |
| 墙拼不成直角 | 房间建出来是斜的、梯形 |
| 绕一圈回不到原点 | 首尾对不上 → 双线重影 |

### 修法

```bash
cd ~/robot_ws
sed -i 's/^\( *wheel_separation:\).*/\1 0.26/' \
  src/my_robot_description/config/robot_controllers.yaml
colcon build --packages-select my_robot_description --symlink-install

# ★ 必须确认 install 里也改了（src 改了 install 没同步是老坑）
grep -E "wheel_separation" \
  install/my_robot_description/share/my_robot_description/config/robot_controllers.yaml
```

> ⚠️ **控制器是 gzserver 里的插件，只重启 SLAM 无效，必须重启 Gazebo。**

### 验证（黄金测试）

让车原地转 90°，看 `odom→base_footprint` 的 yaw：

```bash
ros2 run tf2_ros tf2_echo odom base_footprint
```

| 结果 | 结论 |
|---|---|
| 车转 90°，yaw ≈ **90°** | ✅ 标定正确 |
| yaw ≈ **69°** | ❌ 还是旧参数（90 × 0.765 = 68.9） |

---

<a id="pit2"></a>
## 3. 坑 2｜运动畸变 —— 锯齿状墙

### 现象

地图边缘锯齿状，或者有"双层描边"。

### 定量分析

雷达 **10 Hz**，一帧扫描耗时 **0.1 秒**。这 0.1 秒里车如果正在转弯：

```
一帧内转过的角度 = 角速度 × 0.1 s
```

| 转弯角速度 | 一帧内车转过 | 4 m 外墙面被"抹歪" | 换算格子（0.05 m/格） |
|---|---|---|---|
| **0.8 rad/s** | **4.6°** | **0.32 m** | **6.4 格** ⬅ 锯齿宽度 |
| 0.4 rad/s | 2.3° | 0.16 m | 3.2 格 |
| **0.2 rad/s** | 1.1° | 0.08 m | **1.6 格** ✅ |

`0.32 ÷ 0.05 = 6.4`，正好等于你看到的锯齿宽度——数字对得上，说明病因判断正确。

**原理**：激光扫一圈的过程中车已经转过去了，一帧点云里每个点都是不同朝向时打的，拼起来自然成锯齿。

### 解法

teleop 里按 **`c` 键 6 次**，把 turn 从 0.80 降到 **0.20**。

更重要的是**操作铁律**（比参数更管用）：

```
按 i 走到位置 → 按 k 停死 → 等 1 秒 → 按 l/j 慢慢转 → 按 k 停 → 等 1 秒 → 按 i 继续
```

**绝不允许边走边转。** 平移和旋转叠加时畸变最严重，光降 turn 也救不回来。

### 按键速查

| 键 | 作用 |
|---|---|
| `i` / `,` | 前进 / 后退 |
| `j` / `l` | 左转 / 右转 |
| **`k`** | **停止（转弯前后必按）** |
| `z` / `q` | 总速度 减 / 加 |
| `c` / `e` | 角速度 减 / 加 |

**开局必做**：`z`×4 → speed 0.30，`c`×6 → turn 0.20。

---

<a id="pit3"></a>
## 4. 坑 3｜误闭环 —— 车"瞬移"到隔壁房间

### 现象

车明明在左边房间，地图上的红色标记突然跳到右边房间，Gazebo 里车纹丝不动。

### 原理

slam_toolbox 把**当前扫描**和**历史扫描**做匹配。两个房间都是矩形、家具都靠墙、门洞连通 → 轮廓相似度高过阈值 → 判定"我来过这儿" → 一次性把位姿拽过去。

变的不是车的物理位置，是 **SLAM 对"车在哪"的估计值**。

### 指纹特征

看 `map→odom` 的构成：

| 分量 | 数值 | 含义 |
|---|---|---|
| X 平移 | **−4.983 m** | 巨大的横向位移 |
| 旋转 | 11.356° | 几乎没转 |

**"≈5 米的纯 X 平移 + 几乎不旋转"** = 把左房间匹配成了右房间（两个房间沿 X 轴并列）。

### 解法：提高响应门槛 ⭐

问题出在这两行：

```yaml
loop_match_minimum_response_coarse: 0.1   # ❌ 太低，几乎随便什么都能匹配
loop_match_minimum_response_fine: 0.1     # ❌
```

改成：

```yaml
do_loop_closing: true
loop_search_maximum_distance: 3.0          # 4.0 → 3.0，只和近处匹配
loop_match_minimum_chain_size: 15          # 10 → 15，需要更长证据链
loop_match_minimum_response_coarse: 0.50   # ★ 0.1 → 0.50
loop_match_minimum_response_fine: 0.60     # ★ 0.1 → 0.60
```

小房间或自相似环境如果还出问题，**直接关掉**：

```yaml
do_loop_closing: false
```

20~25 米的绕行路线，标定过的里程计精度完全够，不需要闭环。

### 完整 `slam_params.yaml`

```yaml
slam_toolbox:
  ros__parameters:
    use_sim_time: true

    # ===== 坐标系 =====
    odom_frame: odom
    map_frame: map
    base_frame: base_footprint
    publish_tf: true
    provide_odom_frame: false      # ★ 只发 map→odom，不抢发 odom

    scan_topic: /scan
    queue_size: 20
    mode: mapping

    resolution: 0.05
    map_update_interval: 1.0
    publish_period: 0.05

    max_laser_range: 10.0          # ★ 要和 xacro 里的 <max> 一致
    minimum_time_interval: 0.2
    minimum_travel_distance: 0.30  # ★ 社区建议 0.3~0.5，太小噪声全进图
    minimum_travel_heading: 0.30   # ★ 容易漏写

    solver_plugin: solver_plugins::CeresSolver
    ceres_linear_solver: SPARSE_NORMAL_CHOLESKY
    ceres_preconditioner: SCHUR_JACOBI
    ceres_trust_strategy: LEVENBERG_MARQUIST
    ceres_dogleg_type: TRADITIONAL_DOGLEG
    ceres_loss_function: None

    # ===== 闭环（加严门槛）=====
    do_loop_closing: true
    loop_search_maximum_distance: 3.0
    loop_match_minimum_chain_size: 15
    loop_match_maximum_variance_coarse: 3.0
    loop_match_minimum_response_coarse: 0.50
    loop_match_minimum_response_fine: 0.60

    # ===== 扫描匹配（见坑 11，有里程计误差时必须开）=====
    use_scan_matching: true
    use_scan_barycenter: true
    minimum_angle_change: 0.001
    minimum_distance_change: 0.1
    correlation_search_space_dimension: 0.5
    correlation_search_space_resolution: 0.01
    correlation_search_space_smear_deviation: 0.1

    scan_buffer_size: 10
    scan_buffer_maximum_scan_distance: 10.0

    tf_buffer_duration: 30.0
    transform_publish_period: 0.02
```

---

<a id="pit4"></a>
## 5. 坑 4｜建图"快完成时就崩"

### 原因

不是随机崩溃，是**数据累积到临界点的必然结果**：

| 累积项 | 增长规律 |
|---|---|
| slam_toolbox 位姿图 | 每帧扫描加一个节点，越到后面越大 |
| RViz 点云缓存 | `Decay Time ≠ 0` 时无限堆积 |
| Gazebo 渲染缓冲 | GUI 持续吃显存 |

"快建完" = 累积量最大 → 撞上临界点。

### 三招组合

**① 关掉 Gazebo 窗口**（省 30~50% 内存，RViz 里照样能看）

```bash
ros2 launch my_robot_description gazebo.launch.py gui:=false
```

**② RViz 减负**

| 设置 | 改成 |
|---|---|
| LaserScan → Decay Time | **`0`** ⭐ 这是最吃内存的 |
| Grid / TF | 取消勾选 |
| Global Options → Frame Rate | 30 → **10** |

**③ 定时自动存图（保底，最重要）**

```bash
while true; do
  ros2 run nav2_map_server map_saver_cli -f ~/my_map >/dev/null 2>&1
  echo "[$(date +%H:%M:%S)] 已保存"
  sleep 60
done
```

崩了最多损失 1 分钟。

---

<a id="pit5"></a>
## 6. 坑 5｜拿不到 Gazebo 真值 —— 插件类型错了

### 现象

```
[Err] [gazebo_shared.cc:46] System is attempting to load a plugin,
      but detected an incorrect plugin type. Plugin filename[libgazebo_ros_state.so].
```

### 为什么

Gazebo 插件分三类，**加载方式完全不同**：

| 类型 | 加载方式 | 例子 |
|---|---|---|
| **SystemPlugin** | `gzserver -s xxx.so` | `libgazebo_ros_init.so`（时钟）<br>`libgazebo_ros_factory.so`（spawn 服务） |
| **WorldPlugin** | 写在 `.world` 的 `<world>` 里 | **`libgazebo_ros_state.so`** ⬅ 这里 |
| **ModelPlugin** | 写在 URDF 的 `<gazebo>` 里 | `libgazebo_ros2_control.so` |

`libgazebo_ros_state.so` 是 **World 级插件**，必须挂在一个具体的 world 上才能读到这个世界里的模型列表。塞到 `-s`（SystemPlugin 的位置）类型校验直接失败。

### 修法：写进 world 文件

```xml
<world name="default">
  <plugin name="gazebo_ros_state" filename="libgazebo_ros_state.so">
    <ros>
      <namespace>/gazebo</namespace>
    </ros>
    <update_rate>10.0</update_rate>
  </plugin>
  <!-- ... 其他内容 ... -->
</world>
```

重启 Gazebo 后验证：

```bash
ros2 topic list | grep gazebo
# /gazebo/link_states
# /gazebo/model_states     ← 有它才能读真值
```

### 备选：不依赖话题，用命令行读真值

```bash
gz model -m my_robot -p
```

这条 100% 能用，不受 DDS 影响，做标定时非常好使。

---

<a id="pit6"></a>
## 7. 坑 6｜里程计标定 —— 车一转点云就扭曲 ⭐⭐⭐

这是**最核心**的一坑。前面那些都是治标，这个才是治本。

### 第一步：隔离测试（先定性，2 分钟）

```bash
pkill -9 -f slam_toolbox
```

RViz 里：

- **Fixed Frame 改成 `odom`**（不是 `map`）
- 只显示 `LaserScan`（Decay Time = 0）+ `RobotModel`

开车转几圈：

| 现象 | 结论 |
|---|---|
| 点云**始终贴合墙**，不跟着车转 | ✅ 里程计正常 |
| 车一转，点云**跟着旋转 / 扭曲** | ❌ 里程计要标定 |

### 为什么只靠 URDF 尺寸不够

`wheel_separation: 0.26` 是 CAD 几何真值，但实际还有：

- 轮胎打滑
- 装配误差
- 转弯时轮胎刮擦

所以必须**实测标定**。

### 官方给了三个标定系数 ⭐

| 参数 | 作用 | 默认 |
|---|---|---|
| `wheel_separation_multiplier` | 轮距修正系数 | 1.0 |
| `left_wheel_radius_multiplier` | 左轮半径修正系数 | 1.0 |
| `right_wheel_radius_multiplier` | 右轮半径修正系数 | 1.0 |

**关键**：`wheel_separation` 保持几何真值 0.26 **不动**，只调 multiplier。语义清晰，不和 URDF 打架。

### 快速粗调：90° 测试（1 分钟）

让车原地转 90°，看 odom 报了多少度：

```
wheel_separation_multiplier = 90 ÷ odom 报的度数
```

| odom 报的 | 系数 |
|---|---|
| ≈ 90° | 1.0 ✅ |
| 70° | **1.286** |
| 110° | 0.818 |

> ⚠️ multiplier 只能修**缩放误差**（系统性偏大/偏小）。如果误差随速度、转向方向变化，那是打滑，标定救不了——见文末"仿真打滑"一节。

### 完整标定脚本

自动开车、自动对比 `/odom` 与 Gazebo 真值、自动算系数并写回配置：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""auto_calib.py —— 自动标定里程计
用法: source ~/robot_ws/install/setup.bash && python3 ~/auto_calib.py
"""
import argparse, math, re, sys, time, subprocess
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry

YAML = "/home/wxx/robot_ws/src/my_robot_description/config/robot_controllers.yaml"

def quat_yaw(q):
    s = 2.0 * (q.w * q.z + q.x * q.y)
    c = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
    return math.atan2(s, c)

def gz_pose(name="my_robot"):
    """调 gz model 读真实位姿 -> (x, y, yaw)"""
    try:
        r = subprocess.run(["gz", "model", "-m", name, "-p"],
                           capture_output=True, text=True, timeout=3)
        nums = [float(x) for x in
                re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", r.stdout)]
        if len(nums) >= 6:
            return (nums[0], nums[1], nums[5])
    except Exception:
        pass
    return None

class YawAcc:
    """累积角度，自动处理 ±pi 环绕（转多圈必需）"""
    def __init__(self): self.acc = 0.0; self.last = None
    def reset(self):    self.acc = 0.0; self.last = None
    def update(self, y):
        if self.last is None:
            self.last = y; return
        d = y - self.last
        while d >  math.pi: d -= 2.0 * math.pi
        while d < -math.pi: d += 2.0 * math.pi
        self.acc += d; self.last = y
    @property
    def value(self): return self.acc

class Bot(Node):
    def __init__(self, ot, ct):
        super().__init__("auto_calib")
        self.pub = self.create_publisher(Twist, ct, 10)
        self.create_subscription(Odometry, ot, self.ocb, 50)
        self.oxy = None; self.oy = YawAcc(); self.gy = YawAcc()
    def ocb(self, m):
        p = m.pose.pose.position
        self.oxy = (p.x, p.y)
        self.oy.update(quat_yaw(m.pose.pose.orientation))
    def cmd(self, v, w):
        t = Twist(); t.linear.x = float(v); t.angular.z = float(w)
        self.pub.publish(t)
    def drive(self, v, w, sec, track=False):
        t0 = time.time(); lg = 0.0
        while time.time() - t0 < sec:
            self.cmd(v, w); rclpy.spin_once(self, timeout_sec=0.0)
            if track and time.time() - lg > 0.1:
                p = gz_pose()
                if p: self.gy.update(p[2])
                lg = time.time()
            time.sleep(0.02)
        self.cmd(0.0, 0.0)
    def idle(self, sec):
        t0 = time.time()
        while time.time() - t0 < sec:
            self.cmd(0.0, 0.0); rclpy.spin_once(self, timeout_sec=0.0)
            time.sleep(0.02)

def rc(p):
    o = {"wheel_separation_multiplier": 1.0, "left_wheel_radius_multiplier": 1.0,
         "right_wheel_radius_multiplier": 1.0}
    try: s = open(p).read()
    except IOError: return o
    for k in o:
        m = re.search(rf"^\s*{k}:\s*([-\d.]+)", s, flags=re.M)
        if m: o[k] = float(m.group(1))
    return o

def wr(p, sp, rd):
    s = open(p).read()
    for k, v in [("wheel_separation_multiplier", sp),
                 ("left_wheel_radius_multiplier", rd),
                 ("right_wheel_radius_multiplier", rd)]:
        line = f"    {k}: {v:.4f}"
        s, n = re.subn(rf"^[ \t]*{k}:.*$", line, s, flags=re.M)
        if n == 0: s = s.replace("    wheel_radius:", line + "\n    wheel_radius:", 1)
    open(p, "w").write(s)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turns", type=float, default=2.0)
    ap.add_argument("--speed", type=float, default=0.2)
    ap.add_argument("--straight", type=float, default=5.0)
    a = ap.parse_args()

    rclpy.init()
    n = rclpy.create_node("probe")
    tp = [x for x, _ in n.get_topic_names_and_types()]
    ot = "/odom" if "/odom" in tp else None
    if ot is None:
        c = [x for x in tp if x.endswith("/odom")]
        ot = sorted(c)[0] if c else None
    ct = "/diff_drive_controller/cmd_vel_unstamped" \
         if "/diff_drive_controller/cmd_vel_unstamped" in tp else "/cmd_vel"

    if ot is None:
        print("找不到 odom 话题"); n.destroy_node(); rclpy.shutdown(); return 1

    g = gz_pose()
    if g is None:
        print("读不到真值位姿"); n.destroy_node(); rclpy.shutdown(); return 1
    print(f"[OK] 真实位姿: x={g[0]:.3f} y={g[1]:.3f} yaw={math.degrees(g[2]):.1f}deg")
    n.destroy_node()

    bot = Bot(ot, ct)
    for _ in range(60):
        rclpy.spin_once(bot, timeout_sec=0.05)
        if bot.oxy is not None: break

    old = rc(YAML)

    # ---- 测试1 直线 -> 轮半径 ----
    print(f"[测试1] 直线 {a.straight}s @ {a.speed} m/s（车放空地）")
    input("  >>> 回车开始... ")
    bot.idle(1.0)
    o0 = bot.oxy; g0 = gz_pose()
    bot.drive(a.speed, 0.0, a.straight)
    bot.idle(1.0)
    o1 = bot.oxy; g1 = gz_pose()
    d_odom = math.hypot(o1[0]-o0[0], o1[1]-o0[1])
    d_true = math.hypot(g1[0]-g0[0], g1[1]-g0[1])
    rad = old["left_wheel_radius_multiplier"]
    if d_odom > 0.01: rad = old["left_wheel_radius_multiplier"] * (d_true/d_odom)
    print(f"  odom={d_odom:.4f}m  真实={d_true:.4f}m  误差={abs(d_true-d_odom)*100:.2f}cm")
    print(f"  >> wheel_radius_multiplier = {rad:.4f}")

    # ---- 测试2 转圈 -> 轮距 ----
    omega = 0.5
    dur = 2.0*math.pi*a.turns/omega
    print(f"[测试2] 原地转 {a.turns} 圈（约 {dur:.1f}s）")
    input("  >>> 回车开始... ")
    bot.idle(1.0)
    bot.oy.reset(); bot.gy.reset()
    p = gz_pose()
    if p: bot.gy.update(p[2])
    bot.idle(0.5)
    bot.drive(0.0, omega, dur, track=True)   # ★ 转圈时持续采样真值
    bot.idle(1.0)
    yo = abs(math.degrees(bot.oy.value))
    yt = abs(math.degrees(bot.gy.value))
    sep = old["wheel_separation_multiplier"]
    if yt > 1.0: sep = old["wheel_separation_multiplier"] * (yo/yt)
    print(f"  odom={yo:.2f}deg  真实={yt:.2f}deg  误差={abs(yt-yo):.2f}deg")
    print(f"  >> wheel_separation_multiplier = {sep:.4f}")

    if input("\n写入配置? (y/n): ").strip().lower() == 'y':
        wr(YAML, sep, rad)
        print("[OK] 已写入。下一步: colcon build -> 重启 Gazebo -> 重跑验证")
    bot.destroy_node(); rclpy.shutdown(); return 0

if __name__ == "__main__":
    sys.exit(main())
```

### 修正后的 `robot_controllers.yaml`

```yaml
controller_manager:
  ros__parameters:
    update_rate: 100
    joint_state_broadcaster:
      type: joint_state_broadcaster/JointStateBroadcaster
    diff_drive_controller:
      type: diff_drive_controller/DiffDriveController

diff_drive_controller:
  ros__parameters:
    left_wheel_names: ["left_wheel_joint"]
    right_wheel_names: ["right_wheel_joint"]

    # ★ 几何真值，和 URDF 一致，不要动
    wheel_separation: 0.26
    wheel_radius: 0.05

    # ★ 官方标定系数（跑完脚本自动填，先写 1.0 占位）
    wheel_separation_multiplier: 1.0
    left_wheel_radius_multiplier: 1.0
    right_wheel_radius_multiplier: 1.0

    odom_frame_id: odom
    base_frame_id: base_footprint
    publish_odom: true
    publish_odom_tf: true      # ★ 没有 EKF 时由控制器发；有 EKF 时必须 false
    enable_odom_tf: true       # ★ Humble 里真正管 TF 的是这个开关（见坑 10）
    publish_rate: 50.0         # ★ 必须 ≥50Hz（10Hz 会让地图持续扭曲）

    cmd_vel_timeout: 1.0
    use_stamped_vel: false

    pose_covariance_diagonal: [0.001, 0.001, 0.001, 0.001, 0.001, 0.01]
    twist_covariance_diagonal: [0.001, 0.001, 0.001, 0.001, 0.001, 0.01]

    linear:
      x:
        has_velocity_limits: true
        max_velocity: 0.30
        min_velocity: -0.30
        has_acceleration_limits: true
        max_acceleration: 0.60
        min_acceleration: -0.60
    angular:
      z:
        has_velocity_limits: true
        max_velocity: 0.80
        min_velocity: -0.80
        has_acceleration_limits: true
        max_acceleration: 1.50
        min_acceleration: -1.50
```

### 达标标准

| 指标 | 合格 |
|---|---|
| 直线误差 | **< 2 cm** |
| 转角误差 | **< 2°** |

不达标就 `colcon build` + 重启 Gazebo，**再跑一次**（脚本会用新系数继续收敛，通常 2~3 轮）。

---

<a id="pit7"></a>
## 8. 坑 7｜`map→odom` 硬编码成 0 —— 导航差 5 米 ⭐⭐⭐

### 现象

建图好好的，切到导航后车在地图上的位置和实际差好几米。

### 根因

我用 `static_transform_publisher` 替代 amcl 发 `map→odom`，但写成了**恒等变换**：

```python
arguments=['--x','0','--y','0','--z','0',
           '--roll','0','--pitch','0','--yaw','0', ...]
```

而建图结束时，SLAM 求出的真实关系是：

```
map→odom = [-4.983, 1.781, 11.356°]
```

**硬编码的 0 把这个偏移整个扔掉了。**

### 诊断方法

```bash
ros2 run tf2_ros tf2_echo map odom
```

看 TF 树的 `rate` 字段判断是谁在发：

```
odom:
  parent: 'map'
  rate: 10000.000     ← ⚠️ 静态变换的标志（动态 TF 是 50~100Hz）
```

`rate: 10000` 说明发它的是 `static_transform_publisher`，不是 SLAM。

### 修法 A：填实测值（我当时用的）

**① 在建图结束时（关 SLAM 之前）读值**

```bash
ros2 run tf2_ros tf2_echo map odom
# Translation: [-0.012, 0.151, 0.000]
# Rotation: in RPY (degree) [0.000, -0.000, 1.200]
```

**② yaw 换算成弧度（最容易错的一步）**

```
弧度 = 度 × π / 180
1.200° → 0.0209 rad
```

**③ 填进 `nav2.launch.py`**

```python
MAP_TO_ODOM_X   = '-0.012'
MAP_TO_ODOM_Y   = '0.151'
MAP_TO_ODOM_YAW = '0.0209'   # 1.200° × π/180

static_tf = Node(
    package='tf2_ros',
    executable='static_transform_publisher',
    name='map_to_odom',
    output='screen',
    arguments=[
        '--x', MAP_TO_ODOM_X, '--y', MAP_TO_ODOM_Y, '--z', '0',
        '--roll', '0', '--pitch', '0', '--yaw', MAP_TO_ODOM_YAW,
        '--frame-id', 'map', '--child-frame-id', 'odom',
    ],
)
```

> ⚠️ **切导航时只关 SLAM，不要重启 Gazebo** —— 重启会让 `odom` 归零、车回原点，你读的值就作废了。

### 修法 B：直接交给 amcl（更推荐）

静态 TF 只记录"建图结束那一刻"的偏移，车一动、里程计一漂就失效。正确做法是让 `amcl` 用激光实时发 `map→odom`：

```python
# map_server + amcl + lifecycle_manager 组成定位链
# amcl 打开 set_initial_pose，给定初始位姿（或用 RViz 的 2D Pose Estimate）
```

代价是每次启动都要给一次初始位姿。**如果不给，amcl 会默认自己在 (0,0,0)**，而车实际可能在 1 米外——我遇到过 1.1 m / 158° 的偏差，代价地图直接错位。

> `/initialpose` 有个隐形要求：**`header.stamp` 不能为 0**，否则 amcl 报
> `Received initialpose message is malformed. Rejecting.`
> 用脚本发时记得先等 `/clock`（`use_sim_time` 下没收到时钟前 `now()` 是 0）。

### 效果对比

| 阶段 | `map→odom` | 偏移距离 |
|---|---|---|
| 标定前 | `[-2.027, 1.990]` | **2.8 米** |
| 标定后 | `[-0.012, 0.151]` | **0.15 米** ✅ |

**缩小了 95%**，这就是标定的价值。

---

<a id="pit8"></a>
## 9. 坑 8、9｜Nav2 启动失败的两个经典错误

### ① `Transition is not registered`

```
No transition matching 1 found for current state active
Failed to bring up all requested nodes. Aborting bringup.
Goal was rejected by server
```

**原因**：上次的 Nav2 没杀干净，系统里有**两套** `controller_server` / `planner_server`。新的 lifecycle_manager 看到节点已是 active，却又要 configure（transition 1），生命周期机拒绝。

**解法**：精确 kill Nav2，**别碰 gzserver**

```bash
pkill -9 -f controller_server; pkill -9 -f planner_server
pkill -9 -f bt_navigator;      pkill -9 -f behavior_server
pkill -9 -f velocity_smoother; pkill -9 -f lifecycle_manager
pkill -9 -f map_server;        pkill -9 -f rviz2
pkill -9 -f slam_toolbox
sleep 3

echo "gzserver 存活: $(pgrep -c gzserver)"   # 必须是 1
```

### ② `Node not recognized: RecoveryNode`

```
Exception when loading BT: Error at line 7: -> Node not recognized: RecoveryNode
```

**原因**：`plugin_lib_names` 清单缺项。

**解法**：直接从官方文件同步（版本绝对匹配）

```bash
cd ~/robot_ws
python3 - << 'PY'
import re, yaml
OFF = '/opt/ros/humble/share/nav2_bringup/params/nav2_params.yaml'
USR = 'src/my_robot_description/config/nav2_params.yaml'
plugs = yaml.safe_load(open(OFF))['bt_navigator']['ros__parameters']['plugin_lib_names']
s = open(USR).read()
m = re.search(r'( *)plugin_lib_names:\n((?: *- .*\n)+)', s)
ind = m.group(1)
block = f'{ind}plugin_lib_names:\n' + ''.join(f'{ind}  - {x}\n' for x in plugs)
open(USR, 'w').write(s[:m.start()] + block + s[m.end():])
print(f'已同步官方插件清单（{len(plugs)} 项）')
PY
```

**成功标志**：

```
[lifecycle_manager_navigation]: Managed nodes are active     ⭐
```

---

<a id="pit10"></a>
## 10. 坑 10～12｜"仿真太干净"也是个坑

这三条是后来加 IMU 和 EKF 之后才暴露的，前 9 个坑都修完也不一定碰到。

### 坑 10｜`odom→base_footprint` 有两个发布者

**现象**：slam 位姿周期性从"完全对齐"跳到偏差 7 米，`/map` 忽大忽小，甚至出现 `y=-5.6` 这种房间外的坐标。

**根因**：Humble 的 `diff_drive_controller` 里真正管 TF 的参数是 **`enable_odom_tf`**，`publish_odom_tf` 只是别名。只关后者，控制器照样 50 Hz 发 TF，和 EKF 的 30 Hz 数据交替 → slam 每帧拿到的位姿在两个值之间跳。

抓包就能看到同一时刻两条不同的值：

```
stamp=486.689  parent=odom  xyz=(2.106, -5.298)
stamp=486.700  parent=odom  xyz=(1.318, -2.298)
```

**修法**：

```yaml
diff_drive_controller:
  ros__parameters:
    publish_odom: true        # 数据还要，给 EKF 当输入
    publish_odom_tf: false
    enable_odom_tf: false     # ★ 真正生效的那个
```

**验证**：`ros2 run tf2_ros tf2_echo odom base_footprint` 只应有一个稳定速率（EKF 的输出），不再来回跳。

### 坑 11｜关掉扫描匹配，墙会被画厚一倍

**现象**：地图结构全对，但墙线粗了一倍、边缘一圈散点。占据率 15.4%，而真值位姿建的同一条路线只有 6.2%。

**根因**：`use_scan_matching: false` 是为"真值里程计"准备的——位姿完美时，匹配反而增加误匹配风险。可一旦换成 EKF，odom 每帧都有毫米级抖动；关掉匹配，slam 就退化成"按 odom 位姿逐帧盖印章"，抖动原样落到栅格上。

**修法**：

```yaml
use_scan_matching: true    # ★ 有里程计误差时必须开
```

**实测对比**（同一条 31 航点路线）：

| | 真值位姿建图 | EKF + 关匹配 | EKF + 开匹配 |
|---|---|---|---|
| 地图尺寸 | 158×118 | 161×120 | 157×117 |
| 自由 | 80.2% | 72.4% | **79.9%** |
| 未知 | 13.6% | 12.2% | **14.6%** |
| 占据 | 6.2% | **15.4%** | **5.5%** |

### 坑 12｜两套 nav2 / 两套 odom 同时跑

**现象**：RViz 里机器人"消失"，RobotModel 变红；终端刷 `Invalid frame ID "odom" ... frame does not exist`；或者新启动的 nav2 报 `configure` 失败。

**根因**：旧的一套没关，新的一套又起来 → 重名节点（两个 `map_server`、两个 `amcl`）互抢服务。新栈的 lifecycle_manager 一上来 configure 就撞车，`Failed to change state for node: controller_server`，bringup 直接中止 → amcl 停在 `unconfigured` → `map` 坐标系从来没发布过。

**修法**：起之前先查，有残留就清：

```bash
ps -ef | grep -E "[n]av2_|[a]mcl|[e]kf_node|[r]viz2" | grep -v grep
pkill -f nav2_ ; pkill -f amcl ; pkill -f ekf_node ; pkill -f rviz2
```

**铁律：同一时刻只允许一套 nav2、一个 `odom→base_footprint` 发布者、一个 `/map` 发布者。**

### 顺带：仿真里的"打滑 40%"

Gazebo 默认接触模型下，轮子纵向打滑可以到 40%（轮子转角累计 663 rad ≈ 33 m 轮面行程，车身实际只走十几米）。表现是 odom 虚增、地图被越走越"长"。

三个层面处理：

1. **摩擦参数**：轮子给 `<fdir1>1 0 0</fdir1><mu1>1.0</mu1><mu2>0.1</mu2>`，万向球给 `mu=0.01`（给 0 会让车转向时侧向漂移）
2. **加 IMU + EKF**：yaw 由陀螺仪提供，不受打滑影响；位置仍靠轮速积分，只能削弱不能消除
3. **只做验证时**：用 `/gazebo/model_states` 的真值做里程计，等于开挂，能立刻确认"图不对是定位的锅还是 SLAM 的锅"

```bash
# 三维度自检：真值 vs EKF vs 轮式
gz model -m my_robot -p
ros2 run tf2_ros tf2_echo odom base_footprint
```

---

<a id="flow"></a>
## 11. 完整启动流程（照这个走）

### T1：仿真

```bash
cd ~/robot_ws && source install/setup.bash
ros2 launch my_robot_description gazebo.launch.py gui:=false
```

等 12 秒，必须出现：

```
Spawn status: Successfully spawned entity [my_robot]                    ★
[gazebo_ros2_control]: Loading gazebo_ros2_control plugin               ★
[resource_manager]: Successful 'activate' of hardware 'GazeboSystem'    ★
[spawner_diff_drive_controller]: Configured and activated               ★
[spawner_joint_state_broadcaster]: Configured and activated             ★
```

### T2：定位 + SLAM

```bash
source ~/robot_ws/install/setup.bash
ros2 launch my_robot_description slam_ekf.launch.py   # EKF + slam_toolbox
```

> 没有 IMU 就用 `slam.launch.py`，让控制器自己发 `odom→base_footprint`（此时 `enable_odom_tf: true`）。
> 两套只能用一套，绝不能同时开。

### T3：定时存图

```bash
while true; do
  ros2 run nav2_map_server map_saver_cli -f ~/my_map >/dev/null 2>&1
  echo "[$(date +%H:%M:%S)] 已保存"; sleep 60
done
```

### T4：遥控建图

```bash
ros2 run teleop_twist_keyboard teleop_twist_keyboard \
  --ros-args -r cmd_vel:=/diff_drive_controller/cmd_vel_unstamped
# z×4 → 0.30，c×6 → 0.20
```

### RViz 设置

| 项目 | 设置 |
|---|---|
| **Fixed Frame** | **`map`** |
| RobotModel → Description Source | **`Topic`** / `/robot_description` |
| LaserScan → Topic | `/scan`，**Decay Time = `0`** |
| Add → Map → Topic | `/map`（Durability 设 **Transient Local**，否则图刷不出来） |
| 关掉 | Grid、TF |

### 切导航

```bash
# ① 先读 map→odom（在关 SLAM 之前！）
ros2 run tf2_ros tf2_echo map odom

# ② 用 amcl 定位（推荐），或把读到的值填进 nav2.launch.py

# ③ 只关 SLAM
pkill -9 -f slam_toolbox; sleep 2

# ④ 起 Nav2
ros2 launch my_robot_description nav2.launch.py
```

### 最终验收标准 ⭐

RViz 里 **Fixed Frame = `map`**，看一件事：

> **激光点云是否与地图的黑墙完全重合**

重合 = 全部搞定。差一点就微调那三个值，每次 0.02。

---

<a id="details"></a>
## 12. 容易忽略的细节清单

| 项 | 说明 |
|---|---|
| **spawn 高度** | `-z 0.05` 会让车悬空掉落弹跳，起步就打滑，改 `0.01` |
| **雷达量程一致性** | `slam_params` 的 `max_laser_range` 要和 xacro 的 `<max>` 一致 |
| **房间尺寸 vs 量程** | 房间对角线要 < 雷达量程，否则远端墙扫不到，只能靠里程计硬推 |
| **src → install 同步** | 改完必 `colcon build`，再 grep install 目录确认 |
| **控制器参数改了** | 必须重启 **Gazebo**，只重启 SLAM 无效 |
| **建图/导航二选一** | 绝不能同时开，否则 `map→odom` 被两个源抢发 |
| **同一区域别反复走** | 走太多遍，回环修正会把原本好的局部地图拉变形 |
| **TF 只能有一个源** | 每个坐标系（尤其 `odom→base_footprint`）只允许一个发布者 |

---

<a id="order"></a>
## 13. 排查顺序（照这个来，不迷路）

```
① 雷达正常吗？        /scan 有数据、打到东西 >60%、最远 4~9 m
      ↓
② 控制器 active 吗？   ros2 control list_controllers
      ↓
③ URDF 与 yaml 一致吗？ wheel_separation / wheel_radius
      ↓
④ 里程计准吗？        Fixed Frame=odom，看点云转圈扭不扭曲   ★ 最关键
      ↓
⑤ 标定好了吗？        跑 auto_calib.py，误差 <2cm / <2°
      ↓
⑥ TF 只有一个源吗？   每个坐标系只允许一个发布者（坑 10、12）
      ↓
⑦ 建图参数对吗？      minimum_travel_distance 0.3、闭环门槛 0.5/0.6、扫描匹配开
      ↓
⑧ 开得够慢吗？        speed 0.30 / turn 0.20，停稳再转
      ↓
⑨ map→odom 对吗？     amcl 实时发，或填实测值（yaw 用弧度）
      ↓
⑩ Nav2 起得来吗？     BT 插件同步、进程杀干净
```

## 症状速查表

| 你看到的现象 | 先查这个 |
|---|---|
| 墙斜了 / 房间是梯形 | `wheel_separation`（坑 1） |
| 墙有锯齿、双层 | 转弯太快、边走边转（坑 2） |
| 位姿突然跳到隔壁房间 | 误闭环门槛（坑 3） |
| 位姿在两个位置之间跳 | `odom` TF 有两个发布者（坑 10） |
| 墙很厚、散点很多 | `use_scan_matching`（坑 11） |
| 点云跟着车一起转 | 里程计没标定（坑 6） |
| 导航时车在地图外 | `map→odom` / amcl 初始位姿（坑 7） |
| 机器人不显示、`frame does not exist` | 两套 nav2 / 没有 odom TF（坑 12） |
| 建图中途崩 | 内存累积（坑 4） |

---

<a id="diag"></a>
## 附录｜一键诊断脚本

```bash
source ~/robot_ws/install/setup.bash

echo "=== 进程（重复就是坑 8/12）==="
for p in gzserver gzclient rviz2 slam_toolbox ekf_node controller_server amcl; do
  echo "  $p: $(pgrep -fc $p)"
done

echo "=== 控制器 ==="
ros2 control list_controllers

echo "=== 话题 ==="
timeout 3 ros2 topic hz /scan
ros2 topic list | grep -E "odom|map|scan"

echo "=== 参数 ==="
ros2 param get /diff_drive_controller wheel_separation
ros2 param get /diff_drive_controller enable_odom_tf
ros2 param get /slam_toolbox do_loop_closing
ros2 param get /slam_toolbox use_scan_matching

echo "=== TF（谁在发 odom）==="
ros2 run tf2_ros tf2_echo odom base_footprint
```

---

**最后一句**：地图不对，**先怀疑里程计，再怀疑 SLAM**。

把 `wheel_separation` 修对、把里程计标定完，再确保 TF 只有一个源、扫描匹配是开着的——这四件事做完，我前面那 12 个坑里有 10 个根本不会出现。

祝你的小车一次建图成功 🚗
