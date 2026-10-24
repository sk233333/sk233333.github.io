---
title: "ROS2 差速小车建图导航 - 从地图扭曲到精准对齐的排坑实录"
published: 2026-10-24
description: "用 Gazebo + slam_toolbox + Nav2 建图导航时，我踩了 9 个坑：地图变形、锯齿、误闭环、瞬移、位置差 5 米…这篇带你一个个定位并修掉"
image: "/image/robot_slam/p0.png"
category: "ROS2学习日常"
draft: false
tags: [ROS2, GAZEBO, SLAM, NAV2, slam_toolbox, 建图, 导航, 里程计标定]
---

# 从"建出来的图和实际完全对不上"到"点云与墙完全重合"

这篇文章记录我在用 **Gazebo 仿真 + slam_toolbox 建图 + Nav2 导航** 时踩过的 9 个坑。

先说结论：**这些坑 90% 都不是 slam_toolbox 的锅**，而是里程计标定、坐标系、参数同步、插件加载这些"周边"问题。我一开始一直在调 SLAM 参数，越调越乱，直到回头把里程计修对，一切才通。

![ros2slam](/image/robot_slam/p0.png)

---

## 0. 九个坑一览表（先有个全局印象）

| # | 现象 | 真正原因 | 解法 |
|---|---|---|---|
| 1 | 地图变形、墙不闭合、房间拼不成直角 | `wheel_separation` 与 URDF 不一致（0.34 vs 0.26，差 31%） | 改成 0.26 |
| 2 | 墙是锯齿状 | 运动畸变：雷达 10Hz，转弯 0.8 rad/s，一帧内车转了 4.6° | turn 降到 0.20 |
| 3 | 车在左边房间，地图上突然定位到右边 | 误闭环，响应门槛 `0.1` 太低 | 提到 0.50 / 0.60 |
| 4 | 建图"快完成时就崩" | 资源累积到临界点 + 闭环优化瞬时峰值 | 无 GUI + 自动存图 |
| 5 | 拿不到 Gazebo 真值话题 | `libgazebo_ros_state.so` 是 WorldPlugin，不能用 `-s` 加载 | 写进 world 文件 |
| 6 | 车一转点云就扭曲 | 里程计不准（转弯角度算错） | 用 multiplier 标定 |
| 7 | 导航时车在地图上差 5 米 | `map→odom` 被硬编码成 0 | 填实测值（yaw 用弧度） |
| 8 | `Transition is not registered` | 上次的 Nav2 没杀干净，节点重复 | 精确 kill Nav2 |
| 9 | `Node not recognized: RecoveryNode` | BT 插件清单缺项 | 同步官方 plugin_lib_names |

---

## 1. 环境检测

```bash
ros2 topic list
```

能正常输出（哪怕空列表）说明 ROS2 环境生效。我用的是 **Humble + Gazebo 11（classic）**。

### 确认关键包都在

```bash
ros2 pkg list | grep -E "slam_toolbox|nav2_bringup|gazebo_ros2_control|diff_drive_controller"
```

缺哪个装哪个：

```bash
sudo apt install ros-humble-slam-toolbox \
                 ros-humble-nav2-bringup \
                 ros-humble-gazebo-ros2-control \
                 ros-humble-ros2-controllers -y
```

---

## 2. 机器人模型（xacro）—— 三个必须注意的点

### ① 雷达不要加 `collision`

```xml
<link name="lidar_link">
  <inertial>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <mass value="0.1"/>
    <inertia ixx="0.0001" ixy="0" ixz="0" iyy="0.0001" iyz="0" izz="0.0001"/>
  </inertial>
  <visual>
    <geometry><cylinder radius="0.03" length="0.04"/></geometry>
    <material name="blue"><color rgba="0.2 0.4 0.9 1.0"/></material>
  </visual>
  <!-- ★ 关键：不加 collision，否则激光射线打到自己，/scan 全是 0.1 米 -->
</link>
```

如果雷达扫出来全是近距离值，第一件事就是检查这里。

### ② `rpy="0 0 0"` 保证扫描平面水平

```xml
<joint name="lidar_joint" type="fixed">
  <parent link="base_link"/>
  <child  link="lidar_link"/>
  <!-- 世界 z = 0.05 + 0.11 = 0.16，rpy=0 保证扫描平面水平 -->
  <origin xyz="0.10 0 0.11" rpy="0 0 0"/>
</joint>
```

rpy 不为 0 的话，扫描面会倾斜，打到地面或天花板，地图会莫名多出一圈障碍。

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

放错位置插件不加载，控制器就永远起不来。

### 轮距和轮半径（后面标定的基准）

```xml
<xacro:property name="wheel_radius"      value="0.05"/>
<xacro:property name="wheel_separation"  value="0.26"/>
```

驱动轮 joint 的 y 偏移是 `${reflect * wheel_separation/2}`，所以左轮 y=+0.13、右轮 y=−0.13，**轮距 = 0.26**。

---

## 3. 坑 1：控制器参数与 URDF 不一致 —— 地图变形的元凶 ⭐⭐⭐

### 现象

墙拼不成直角、房间是梯形、绕一圈首尾对不上产生双线重影。

### 诊断（30 秒）

```bash
# 对比两个文件里的值
grep -E "wheel_separation|wheel_radius" \
  ~/robot_ws/src/my_robot_description/urdf/robot.urdf.xacro
grep -E "wheel_separation|wheel_radius" \
  ~/robot_ws/install/my_robot_description/share/my_robot_description/config/robot_controllers.yaml
```

我当时是：

| 参数 | URDF | yaml | 偏差 |
|---|---|---|---|
| `wheel_radius` | 0.05 | 0.05 | ✅ |
| **`wheel_separation`** | **0.26** | **0.34** | ❌ **差 31%** |

**0.34 是旧模型的轮距**（旧轮子在 y=±0.17）。我改了模型却忘了同步控制器。

### 为什么会毁掉地图

差速车转弯角度靠这个算：

```
转过的角度 θ = (右轮位移 − 左轮位移) / 轮距
                                      ↑
                        这里用的是 0.34，真实是 0.26
```

车实际转 100°，里程计只记 **76.5°**（0.26/0.34）。

| 后果 | 表现 |
|---|---|
| 转弯角度系统性偏小 | 每个弯都"欠转"，累积后整个地图被扭曲 |
| 墙拼不成直角 | 房间建出来是斜的/梯形 |
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
ros2 run teleop_twist_keyboard teleop_twist_keyboard \
  --ros-args -r cmd_vel:=/diff_drive_controller/cmd_vel_unstamped
ros2 run tf2_ros tf2_echo odom base_footprint
```

| 结果 | 结论 |
|---|---|
| 车转 90°，yaw ≈ **90°** | ✅ 标定正确 |
| yaw ≈ **69°** | ❌ 还是旧参数（90 × 0.765 = 68.9） |

---

## 4. 坑 2：运动畸变 —— 锯齿状墙

### 现象

地图边缘是锯齿状、有"双层描边"。

### 定量分析

雷达 **10Hz**，一帧扫描耗时 **0.1 秒**。这 0.1 秒里车如果正在转弯：

```
一帧内转过的角度 = 转弯速度 × 0.1 秒
```

| 转弯速度 | 一帧内车转过 | 4m 外墙面被"抹歪" | 换算像素（0.05m/格） |
|---|---|---|---|
| **0.8 rad/s** | **4.6°** | **0.32 m** | **6.4 格** ⬅ 锯齿宽度 |
| 0.4 rad/s | 2.3° | 0.16 m | 3.2 格 |
| **0.2 rad/s** | 1.1° | 0.08 m | **1.6 格** ✅ |

**0.32 ÷ 0.05 = 6.4 个格子** —— 正好是锯齿宽度。

**原理**：激光扫一圈的过程中车已经转过去了，一帧点云里每个点都是在不同朝向时打的，拼起来自然成锯齿。

### 解法

teleop 里按 **`c` 键 6 次**，把 turn 从 0.80 降到 **0.20**。

配合**操作铁律**（比参数更重要）：

```
按 i 走到位置 → 按 k 停死 → 等 1 秒 → 按 l/j 慢慢转 → 按 k 停 → 等 1 秒 → 按 i 继续
```

**绝不允许边走边转** —— 平移+旋转叠加时畸变最严重，光降 turn 也救不回来。

### 按键速查

```
      u    i    o
      j    k    l
      m    ,    .
```

| 键 | 作用 |
|---|---|
| `i` | 前进 |
| `,` | 后退 |
| `j` / `l` | 左转 / 右转 |
| **`k`** | **停止（转弯前后必按）** |
| `z` / `q` | 总速度 减/加 |
| `c` / `e` | 转角速度 减/加 |

**开局必做**：`z`×4 → speed 0.30，`c`×6 → turn 0.20

---

## 5. 坑 3：误闭环 —— 车瞬移到隔壁房间

### 现象

车明明在左边房间，地图上的红色标记突然跳到右边房间。Gazebo 里车纹丝不动。

### 原理

slam_toolbox 把**当前扫描**和**历史扫描**做匹配。两个房间都是矩形、家具都靠墙、门洞连通 → 轮廓相似度高过阈值 → 判定"我来过这儿" → 一次性把位姿拽过去。

变的不是车的物理位置，是 **SLAM 对"车在哪"的估计值**。

### 指纹特征

看 `map→odom` 的构成：

| 分量 | 数值 | 含义 |
|---|---|---|
| X 平移 | **−4.983 m** | 巨大的横向位移 |
| 旋转 | 11.356° | 几乎没转 |

**"≈5 米的纯 X 平移 + 几乎不旋转"** = 把左房间匹配成右房间（两房间沿 X 轴并列）。

### 解法：提高响应门槛 ⭐

我原来的配置：

```yaml
loop_match_minimum_response_coarse: 0.1   # ❌ 太低！几乎随便什么都能匹配
loop_match_minimum_response_fine: 0.1     # ❌
```

**这才是误闭环的直接原因**。改成：

```yaml
slam_toolbox:
  ros__parameters:
    do_loop_closing: true
    loop_search_maximum_distance: 3.0          # 4.0 → 3.0，只和近处匹配
    loop_match_minimum_chain_size: 15          # 10 → 15，需要更长证据链
    loop_match_minimum_response_coarse: 0.50   # ★ 0.1 → 0.50
    loop_match_minimum_response_fine: 0.60     # ★ 0.1 → 0.60
```

小房间如果还出问题，直接关掉：

```yaml
    do_loop_closing: false
```

25 米的绕行路线，里程计精度完全够，不需要闭环。

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

    max_laser_range: 10.0
    minimum_time_interval: 0.2
    minimum_travel_distance: 0.30      # ★ 社区建议 0.3~0.5，太小噪声全进图
    minimum_travel_heading: 0.30       # ★ 容易漏

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

## 6. 坑 4：建图"快完成时就崩"

### 原因

不是随机崩溃，是**数据积累到临界点的必然结果**：

| 累积项 | 增长规律 |
|---|---|
| slam_toolbox 位姿图 | 每帧扫描加一个节点，越到后面越大 |
| RViz 点云缓存 | `Decay Time ≠ 0` 时无限堆积 |
| Gazebo 渲染缓冲 | GUI 持续吃显存 |

"快建完" = 累积量最大 → 撞上临界点。

### 三招组合

**① `gui:=false` 关掉 Gazebo 窗口**（省 30~50% 内存，RViz 里都能看到）

```bash
ros2 launch my_robot_description gazebo.launch.py gui:=false
```

**② RViz 减负**

| 设置 | 改成 |
|---|---|
| LaserScan → Decay Time | **`0`** ⭐（这是最吃内存的） |
| Grid / TF | 取消勾选 |
| Global Options → Frame Rate | 30 → **10** |

**③ 后台自动存图（保底，最重要）**

```bash
while true; do
  ros2 run nav2_map_server map_saver_cli -f ~/my_map >/dev/null 2>&1
  echo "[$(date +%H:%M:%S)] 已保存"
  sleep 60
done
```

崩了最多损失 1 分钟。

---

## 7. 坑 5：拿不到 Gazebo 真值 —— 插件类型错误

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
| **WorldPlugin** | 写在 `.world` 的 `<world>` 里 | **`libgazebo_ros_state.so`** ⬅ 你的情况 |
| **ModelPlugin** | 写在 URDF 的 `<gazebo>` 里 | `libgazebo_ros2_control.so` |

`libgazebo_ros_state.so` 是 **World 级插件** —— 它必须挂在一个具体的 world 上才能读到这个世界的模型列表。塞进 `-s`（SystemPlugin 位置）类型校验就失败。

### 修法：写进 world 文件

```xml
<world name="default">
    <plugin name="gazebo_ros_state" filename="libgazebo_ros_state.so">
      <ros>
        <namespace>/gazebo</namespace>
      </ros>
      <update_rate>10.0</update_rate>
    </plugin>
    ...
```

用命令插入：

```bash
cd ~/robot_ws
python3 - << 'PY'
p = 'src/my_robot_description/config/my_world.world'
s = open(p).read()
if 'libgazebo_ros_state.so' not in s:
    s = s.replace('<world name="default">',
        '<world name="default">\n'
        '    <plugin name="gazebo_ros_state" filename="libgazebo_ros_state.so">\n'
        '      <ros>\n'
        '        <namespace>/gazebo</namespace>\n'
        '      </ros>\n'
        '      <update_rate>10.0</update_rate>\n'
        '    </plugin>', 1)
    open(p, 'w').write(s)
    print('已插入')
PY
```

重启 Gazebo 后验证：

```bash
ros2 topic list | grep gazebo
# /gazebo/link_states
# /gazebo/model_states     ← 有了才能读真值
```

### 备选：不用话题，用命令行

如果上面嫌麻烦，直接用 `gz` 命令读真值，100% 能用：

```bash
gz model -m my_robot -p
```

---

## 8. 坑 6：里程计标定 —— 车一转点云就扭曲 ⭐⭐⭐

这是**最核心**的一坑。前面那些都是治标，这个才是治本。

### 第一步：隔离测试（先定性，2 分钟）

```bash
pkill -9 -f slam_toolbox
```

RViz 里：
- **Fixed Frame 改成 `odom`**（不是 map）
- 只显示 `LaserScan`（Decay Time=0）+ `RobotModel`

开车转几圈：

| 现象 | 结论 |
|---|---|
| 点云**始终贴合墙**、不跟着车转 | ✅ 里程计正常 |
| 车一转，点云**跟着旋转/扭曲** | ❌ **里程计要标定** |

### 为什么光靠 URDF 尺寸不够

`wheel_separation: 0.26` 是 CAD 几何真值，但实际有：
- 轮胎打滑
- 装配误差
- 转弯时轮胎刮擦

所以必须**实测标定**。

### 官方提供了专门的标定参数 ⭐

| 参数 | 作用 | 默认 |
|---|---|---|
| `wheel_separation_multiplier` | 轮距修正系数 | 1.0 |
| `left_wheel_radius_multiplier` | 左轮半径修正系数 | 1.0 |
| `right_wheel_radius_multiplier` | 右轮半径修正系数 | 1.0 |

**关键**：`wheel_separation` 保持几何真值 0.26 **不动**，只调 multiplier。语义清晰，不和 URDF 打架。

### 快速粗调：90° 测试（1 分钟）

让车原地转 90°，看 odom 报多少度：

```
wheel_separation_multiplier = 90 ÷ odom报的度数
```

| odom 报的 | 系数 |
|---|---|
| ≈ 90° | 1.0 ✅ |
| 70° | **1.286** |
| 110° | 0.818 |

### 完整标定脚本

自动开车、自动对比 `/odom` 与 Gazebo 真值、自动算系数写回配置：

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
    o = {"wheel_separation_multiplier":1.0,"left_wheel_radius_multiplier":1.0,
         "right_wheel_radius_multiplier":1.0}
    try: s = open(p).read()
    except IOError: return o
    for k in o:
        m = re.search(rf"^\s*{k}:\s*([-\d.]+)", s, flags=re.M)
        if m: o[k] = float(m.group(1))
    return o

def wr(p, sp, rd):
    s = open(p).read()
    for k, v in [("wheel_separation_multiplier",sp),("left_wheel_radius_multiplier",rd),
                 ("right_wheel_radius_multiplier",rd)]:
        line = f"    {k}: {v:.4f}"
        s, n = re.subn(rf"^[ \t]*{k}:.*$", line, s, flags=re.M)
        if n == 0: s = s.replace("    wheel_radius:", line+"\n    wheel_radius:", 1)
    open(p,"w").write(s)

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
    publish_odom_tf: true
    publish_rate: 50.0          # ★ 必须 ≥50Hz（10Hz 会让地图持续扭曲）

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

## 9. 坑 7：`map→odom` 被硬编码成 0 —— 导航时差 5 米 ⭐⭐⭐

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

在看 TF 树时有个关键信号：

```
odom:
  parent: 'map'
  rate: 10000.000        ← ⚠️ 静态变换的标志（动态 TF 是 50~100Hz）
```

`rate: 10000` 说明发它的是 static_transform_publisher，不是 SLAM。

### 修法

**① 在建图结束时（关 SLAM 之前）读值**

```bash
ros2 run tf2_ros tf2_echo map odom
```

得到：
```
- Translation: [-0.012, 0.151, 0.000]
- Rotation: in RPY (degree) [0.000, -0.000, 1.200]
```

**② yaw 换算成弧度（最容易错的一步）**

```
弧度 = 度 × 3.14159 / 180
1.200° → 0.0209 rad
```

**③ 填进 `nav2.launch.py`**

```python
    # ★ 建图结束时实测的 map→odom（yaw 用弧度！）
    MAP_TO_ODOM_X   = '-0.012'
    MAP_TO_ODOM_Y   = '0.151'
    MAP_TO_ODOM_YAW = '0.0209'   # 1.200° × π/180

    static_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='map_to_odom',
        output='screen',
        arguments=[
            '--x', MAP_TO_ODOM_X,
            '--y', MAP_TO_ODOM_Y,
            '--z', '0',
            '--roll', '0', '--pitch', '0', '--yaw', MAP_TO_ODOM_YAW,
            '--frame-id', 'map',
            '--child-frame-id', 'odom',
        ],
    )
```

> ⚠️ **切导航时只关 SLAM，不要重启 Gazebo** —— 重启会让 `odom` 归零、车回原点，你读的值就作废了。

### 效果对比

| 阶段 | `map→odom` | 偏移距离 |
|---|---|---|
| 标定前 | `[-2.027, 1.990]` | **2.8 米** |
| 标定后 | `[-0.012, 0.151]` | **0.15 米** ✅ |

**缩小了 95%**，这就是标定的价值。

---

## 10. 坑 8 & 9：Nav2 启动失败的两个经典错误

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
pkill -9 -f bt_navigator; pkill -9 -f behavior_server
pkill -9 -f velocity_smoother; pkill -9 -f lifecycle_manager
pkill -9 -f map_server; pkill -9 -f rviz2; pkill -9 -f slam_toolbox
sleep 3; rm -rf /dev/shm/*cyclonedds* 2>/dev/null

echo "gzserver 存活: $(pgrep -c gzserver)"    # 必须是 1
```

### ② `Node not recognized: RecoveryNode`

```
Exception when loading BT: Error at line 7: -> Node not recognized: RecoveryNode
```

**原因**：`plugin_lib_names` 清单缺了 `nav2_recovery_node_bt_node` 等项。

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
open(USR,'w').write(s[:m.start()] + block + s[m.end():])
print(f'已同步官方插件清单（{len(plugs)} 项）')
PY
```

**成功标志**：
```
[lifecycle_manager_navigation]: Managed nodes are active     ⭐
```

---

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

### T2：SLAM

```bash
source ~/robot_ws/install/setup.bash
ros2 launch my_robot_description slam.launch.py
```

### T3：自动存图

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
| Add → Map → Topic | `/map` |
| 关掉 | Grid、TF |

### 切导航

```bash
# ① 先读 map→odom（在关 SLAM 之前！）
ros2 run tf2_ros tf2_echo map odom

# ② 填进 nav2.launch.py，colcon build

# ③ 只关 SLAM
pkill -9 -f slam_toolbox; sleep 2

# ④ 起 Nav2
ros2 launch my_robot_description nav2.launch.py
```

### 最终验收标准 ⭐

RViz 里 **Fixed Frame = `map`**，看：

> **激光点云是否与地图的黑墙完全重合**

重合 = 全部搞定。差一点就微调那三个值，每次改 0.02。

---

## 12. 一些容易忽略的细节

| 项 | 说明 |
|---|---|
| **spawn 高度** | `-z 0.05` 会让车悬空掉落弹跳，起步就打滑。改 `0.01` |
| **雷达量程一致性** | `slam_params` 的 `max_laser_range` 要和 xacro 的 `<max>` 一致 |
| **房间尺寸 vs 量程** | 房间对角线要 < 雷达量程，否则远端墙扫不到，只能靠里程计硬推 |
| **src → install 同步** | 改完必 `colcon build`，再 grep install 目录确认 |
| **控制器参数改了** | 必须重启 **Gazebo**，只重启 SLAM 无效 |
| **建图/导航二选一** | 绝不能同时开，否则 `map→odom` 被两个源抢发 |
| **同一区域别反复走** | 走太多遍，回环修正会把原本好的局部地图拉变形 |

---

## 13. 总结：排查顺序（照这个来，不迷路）

```
① 雷达正常吗？        /scan 有数据、打到东西 >60%、最远 4~9m
      ↓
② 控制器 active 吗？   ros2 control list_controllers
      ↓
③ URDF 与 yaml 一致吗？ wheel_separation / wheel_radius
      ↓
④ 里程计准吗？        Fixed Frame=odom，看点云转圈扭不扭曲   ★ 最关键
      ↓
⑤ 标定好了吗？        跑 auto_calib.py，误差 <2cm / <2°
      ↓
⑥ 建图参数对吗？      minimum_travel_distance 0.3、闭环门槛 0.5/0.6
      ↓
⑦ 开得够慢吗？        speed 0.30 / turn 0.20，停稳再转
      ↓
⑧ map→odom 填了吗？   建完读值、换算弧度、填进 nav2.launch.py
      ↓
⑨ Nav2 起得来吗？     BT 插件同步、进程杀干净
```

**核心体会**：地图不对，**先怀疑里程计，再怀疑 SLAM**。我一开始一直在调 SLAM 参数（闭环门槛、扫描阈值），越调越乱；直到把 `wheel_separation` 修正、做完标定，问题才一次性全部消失。

---

## 附：一键诊断脚本

```bash
source ~/robot_ws/install/setup.bash

echo "=== 进程 ==="
for p in gzserver gzclient rviz2 slam_toolbox; do
  echo "  $p: $(pgrep -c $p)"
done

echo "=== 控制器 ==="
ros2 control list_controllers

echo "=== 话题 ==="
ros2 topic hz /scan & sleep 3; kill %1 2>/dev/null
ros2 topic list | grep -E "odom|map|scan"

echo "=== 参数 ==="
ros2 param get /diff_drive_controller wheel_separation
ros2 param get /slam_toolbox do_loop_closing

echo "=== TF ==="
ros2 run tf2_ros tf2_echo map odom
```

以上就是整个排坑过程。祝你的小车一次建图成功 🚗
