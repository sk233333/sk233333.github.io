---
title: "ROS2 节点+服务项目-小乌龟转圈详细解读"
published: 2026-10-09
description: "用大量的注释带你了解这个项目背后可以学到什么"
image: ""
category: "ROS2学习日常"
draft: false
tags: [ROS2, PYTHON, C++, 节点, 服务, 小乌龟]
---
# 这个是github同款开源小项目解读


## 1.检测ros2环境是否生效
```bash
ros2 topic list
```
如果能正常输出无error(即使为空列表)，说明你的ROS2环境已经正常生效。


## 2.检查你的ros2小海龟是否正常
```bash
ros2 pkg list | grep turtlesim
```
### 如果以正常输出turtlesim，没有的话需要按照下面方式安装：
```bash
sudo apt install ros-humble-turtlesim -y
# jazzy用户把humble换成jazzy
```


### 先手动跑一下海龟，确认环境没问题
```bash
ros2 run turtlesim turtlesim_node
```
会弹出一个蓝底窗口，中间有只海龟。
![ros2xwg35](/public/image/xwg_node/p1-1.png)


### 现在顺便看一眼海龟有哪些话题（这一步很重要！！！）保持之前窗口运行，新开一个窗口 
```bash
ros2 topic list
```
看看有没有/turtle1/cmd_vel 和 /turtle1/pose 


#### 1.我们先看cmd_vel(发给海龟的速度指令： 
看它的数据格式： 
```bash
ros2 topic info /turtle1/cmd_vel -v
```
![ros2xwg49行](/public/image/xwg_node/p2-1.png)


滑到第一行Type会显示：Type: geometry_msgs/msg/Twist （Twist是我们写代码要import的类型


##### 让我们看看它字段长什么样： 
```bash
ros2 interface show geometry_msgs/msg/Twist
```


![ros2xwg62行](/public/image/xwg_node/p2-2.png)


Vector3  linear float64 x float64 y float64 z （xyz方向线速度


Vector3  angular float64 x float64 y float64 z （xyz方向加速度


# 2我们再看pose（使用pose,海龟会报出自己真实位置


看它的数据格式：
```bash
ros2 topic info /turtle1/pose -v
```


![ros2xwg81](/public/image/xwg_node/p2-3.png)


滑到前面Type会显示：Topic type: turtlesim/msg/Pose （Pose是我们写代码要import的类型


让我们看看字段长什么样：
```bash
ros2 interface show turtlesim/msg/Pose
```


![ros2xwg93](/public/image/xwg_node/p2-4.png)


float32 x float32 y float32 （海龟在仿真窗口中的二维坐标位置（单位通常视为米）turtlesim 默认窗口坐标大致是 x: 0~11.08，y: 0~11.08。左下角为 (0,0)，右上角为最大值。


theta （海龟的朝向角（偏航角），单位是弧度（rad）theta = 0 表示头朝正右方（X 轴正向）。逆时针旋转为正，顺时针为负。范围通常在 -π ~ π 之间


float32 linear_velocity （线速度（前进/后退的速度），单位 m/s，正值表示向前游，负值表示向后退。如果静止则为 0.0


float32 angular_velocity （角速度（原地旋转的速度），单位 rad/s，正值表示逆时针转，负值表示顺时针转。


## 3.建立三个包（~/xwg/turtle_ws/src$ 在这个地址下创建包






想强调就 **加粗**，想写代码就 `这样`。

## 小标题二

- 列表项
- 列表项

```js
console.log("这段代码会带高亮、行号和复制按钮");
```

> [!NOTE]
> 这是个提示框，也支持 [!TIP] [!WARNING] [!IMPORTANT]

## 小标题三

结尾。
