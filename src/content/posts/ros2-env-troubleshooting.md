---
title: "ROS2 入门踩坑实录：从跟着教程走到彻底搞懂环境配置"
published: 2026-10-03
description: "记录 ROS2 Humble 入门阶段 DDS、虚拟环境、编译残留的完整排查过程"
tags: [ROS2, Linux, 踩坑记录]
---
ROS 2 入门踩坑实录：从“跟着教程走”到搞懂环境配置
跟着教程运行第一个 ROS 2 节点，却被环境问题折磨了一整天。本文记录从 sequence size exceeds remaining buffer 到 ModuleNotFoundError 的排查过程，也尝试回答一个问题：为什么教程里什么都不用配置，我却遇到了这么多问题？

一、问题的起点：一个最简单的节点
教程中的命令非常简单：

BASH
ros2 run demo_python_pkg python_node
教程输出：

TEXT
[INFO] [python_node]: 你好 Python 节点
但我实际运行时，终端还不断打印：

TEXT
sequence size exceeds remaining buffer
sequence size exceeds remaining buffer
[INFO] [python_node]: 你好 Python 节点
节点虽然启动成功，但 DDS 层不断刷警告。这成为后续排查的起点。

二、DDS 警告：sequence size exceeds remaining buffer
ROS 2 不直接负责节点间通信，而是通过 DDS 完成：

节点发现；
消息传输；
序列化和反序列化；
QoS 协商。
sequence size exceeds remaining buffer 通常表示 DDS 在解析数据包时，发现数据长度与实际缓冲区不一致。

常见原因包括：

不同 ROS 2 发行版或 DDS 实现混用；
网络中存在多个网卡、VPN、Docker 或异常多播；
DDS 共享内存残留；
切换 RMW 实现后，旧节点或旧环境仍在运行；
不同终端加载了不同的 ROS 2 环境。
需要注意：

这类错误不一定是 Python 解释器导致的。Python 环境错配更常见的表现是 ModuleNotFoundError、ImportError 或 PackageNotFoundError。

先检查当前环境：

BASH
echo "$ROS_DISTRO"
echo "$RMW_IMPLEMENTATION"
which ros2
which python3
python3 -c "import rclpy; print(rclpy.__file__)"
如果 Fast DDS 在当前环境下不稳定，可以尝试切换到 Cyclone DDS。

安装 Cyclone DDS
BASH
sudo apt update
sudo apt install ros-humble-rmw-cyclonedds-cpp
临时切换
BASH
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
ros2 run demo_python_pkg python_node
确认问题确实消失后，再写入 
~/.bashrc

：

BASH
echo 'export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp' >> ~/.bashrc
source ~/.bashrc
三、切换 DDS 后的 daemon 缓存问题
切换 DDS 后，我执行：

BASH
ros2 node list
却出现了 CLI daemon 相关的 traceback。

ROS 2 CLI daemon 会缓存节点和话题信息，以加快命令执行。如果切换了 DDS 实现，旧 daemon 可能仍然运行在旧环境中。

可以先重启 daemon：

BASH
ros2 daemon stop
ros2 daemon start
ros2 node list
部分 ROS 2 版本也支持绕过 daemon：

BASH
ros2 node list --no-daemon
如果仍然异常，可以清理 CLI 缓存：

BASH
rm -rf ~/.ros/ros2cli
不建议一遇到问题就删除整个 
~/.ros/

，因为其中可能还保存着日志或其他运行数据。

另外，网上常见的：

BASH
export ROS2_DISABLE_DAEMON=1
并不是所有 ROS 2 版本都支持，不能把它当作通用解决方案。优先使用 ros2 daemon stop、start 或 --no-daemon。

四、Python 虚拟环境：隔离包也隔离了 ROS 2
ROS 2 的 Python 包，例如 rclpy，通常通过 apt 安装在系统 Python 环境中。

如果直接使用普通虚拟环境：

BASH
python3 -m venv ~/ros2_pyenv
source ~/ros2_pyenv/bin/activate
可能会出现：

TEXT
ModuleNotFoundError: No module named 'rclpy'
因为虚拟环境默认看不到系统 Python 包。

如果确实需要使用虚拟环境，可以创建时添加：

BASH
python3 -m venv --system-site-packages ~/ros2_pyenv
然后加载 ROS 2 环境：

BASH
source ~/ros2_pyenv/bin/activate
source /opt/ros/humble/setup.bash
检查 rclpy 是否可用：

BASH
python3 -c "import rclpy; print(rclpy.__file__)"
不过在学习 ROS 2 基础功能时，更推荐：

TEXT
系统 Python + apt 安装的 ROS 2 + 正确加载 setup.bash
这样可以少处理很多解释器和路径问题。

五、不要直接运行 install 目录下的入口脚本
在工作空间中可以看到类似文件：

TEXT
install/demo_python_pkg/lib/demo_python_pkg/python_node
它是 colcon 生成的 Python 入口脚本，并不是一个完全独立的程序。

直接运行：

BASH
cd install/demo_python_pkg/lib/demo_python_pkg
./python_node
可能会遇到：

TEXT
No such file or directory
或者：

TEXT
PackageNotFoundError
这是因为运行时可能缺少：

ROS 2 环境变量；
正确的 PYTHONPATH；
Python 包元数据；
当前工作空间的 overlay 环境。
正确做法是：

BASH
cd ~/chapt2
source /opt/ros/humble/setup.bash
source install/setup.bash
ros2 run demo_python_pkg python_node
ros2 run 会按照 ROS 2 的包管理方式查找包和可执行入口。入门阶段优先使用它，可以避免很多路径问题。

六、ModuleNotFoundError：清理构建残留
如果反复修改了包结构、入口点或 Python 文件名，可能出现：

TEXT
ModuleNotFoundError: No module named 'demo_python_pkg.python_node'
常见原因是：

setup.py 中的入口点写错；
__init__.py 缺失；
入口点仍然指向旧模块；
build、install 中保留了旧构建结果；
当前终端没有 source 最新的工作空间。
确认代码和包配置无误后，可以彻底重建：

BASH
cd ~/chapt2
rm -rf build install log
source /opt/ros/humble/setup.bash
colcon build --symlink-install
source install/setup.bash
然后检查包是否被正确发现：

BASH
ros2 pkg list | grep demo_python_pkg
ros2 pkg prefix demo_python_pkg
入口点通常类似于：

PYTHON
entry_points={
    'console_scripts': [
        'python_node = demo_python_pkg.python_node:main',
    ],
}
这要求：

存在 demo_python_pkg/ 目录；
目录中存在 __init__.py；
存在 python_node.py；
文件中存在 main() 函数。
七、推荐的标准流程
1. 加载 ROS 2 环境
BASH
source /opt/ros/humble/setup.bash
2. 构建工作空间
BASH
cd ~/chapt2
colcon build --symlink-install
3. 加载工作空间
BASH
source install/setup.bash
4. 运行节点
BASH
ros2 run demo_python_pkg python_node
如果确认要使用 Cyclone DDS，可以在加载环境后设置：

BASH
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
为了避免每次手动输入，可以将以下内容写入 
~/.bashrc

：

BASH
source /opt/ros/humble/setup.bash
source ~/chapt2/install/setup.bash
export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
修改后执行：

BASH
source ~/.bashrc
八、问题速查表
现象	常见原因	优先处理方式
sequence size exceeds remaining buffer	DDS 发现、网络或版本环境异常	检查 RMW，必要时尝试 Cyclone DDS
ros2 node list 报 traceback	daemon 使用旧环境或缓存异常	重启 daemon，必要时清理 
~/.ros/ros2cli

No module named rclpy	虚拟环境隔离系统包	检查 which python3，退出虚拟环境
No module named demo_python_pkg...	入口点或构建产物异常	删除 build install log 后重新构建
PackageNotFoundError	没有 source 工作空间	执行 
source install/setup.bash
教程能运行，自己不能运行	教程作者已完成一次性配置	检查 .bashrc 和 ROS 2 环境
九、总结
这次排查让我真正理解了几个问题：

教程展示的是使用过程，不一定包含首次环境配置过程。
ROS 2 的很多问题发生在环境层，而不是代码层。
系统 Python 和正确的 setup.bash，通常是入门阶段最省事的组合。
切换 DDS 后，要注意旧节点和 CLI daemon 是否仍在运行。
遇到模块找不到时，不要只盯着代码，也要检查构建产物和 Python 路径。
入门阶段优先使用 ros2 run，不要直接运行 install 目录中的入口脚本。
ROS 2 入门最难的部分，往往不是写出第一个节点，而是搞清楚这个节点到底运行在哪个环境里。
