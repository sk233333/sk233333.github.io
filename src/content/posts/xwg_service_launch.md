---
title: "ROS2 服务+TF 项目-小乌龟随机巡逻与坐标系可视化详解"
published: 2026-10-15
description: "在上一个话题项目基础上，引入 ROS2 第二种通信方式：服务（Service），并让 RViz2 实时看到两只海龟的坐标系"
image: "/image/xwg_node/p20-1.jpg"
category: "ROS2学习日常"
draft: false
tags: [ROS2, PYTHON, C++, 服务, TF, 小乌龟, 四元数, RViz2]
---


# ROS2 服务+TF 项目-小乌龟随机巡逻与坐标系可视化详解


##  本篇接上一个话题项目。上一篇里 turtle1 一直在转圈，所有数据都是"发完就不管"的广播。


### 这一篇要做两件事：


1. **用服务（Service）** 让第二只海龟 turtle2 按随机目标点巡逻——客户端需要知道"到了没有"。


2. **用launch** 一键启动两个小海龟。


2. **用 TF（坐标变换）** 让 RViz2 里实时看到两只海龟各自的坐标系跟着动。




## 1. 为什么"巡逻到某个点"必须用服务


为什么"巡逻到某个点"适合用服务？


因为**客户端需要知道"到了没有"**。话题是单向广播，回不来；


服务是问答，服务端能明确告诉你 `success: true`。

对应到本篇的三步设计：

1. **动态接收服务** —— 服务端随时待命，客户端什么时候请求都行。


2. **自定义接口** —— 没有现成的"巡逻"服务，自己写一个 `.srv`。


3. **客户端产生随机点并请求** —— C++ 节点随机生成坐标，调用服务让海龟走过去。


## 2. 整体架构


- **Python**：`spawn_turtle`（创建海龟）+ `patrol_server`（服务端，闭环控制海龟走路）

  
- **C++**：`patrol_client`（客户端，产生随机点、请求服务、等待结果）


- **TF 广播**：`tf_broadcaster`（订阅两只海龟的 pose，广播成坐标系）


## 3. 第一步：定义服务接口


### 3.1 创建 .srv 文件


```bash
mkdir -p ~/xwg/turtle_ws/src/turtle_interfaces/srv
gedit ~/xwg/turtle_ws/src/turtle_interfaces/srv/Patrol.srv
```


#### 以下是srv内具体内容：
```srv
# ============================================
# 巡逻服务接口
# .srv 文件用 --- 分成上下两部分：
#   上面 = 请求（客户端 → 服务端）
#   下面 = 响应（服务端 → 客户端）
# ============================================

# ---- 请求：请巡逻到这个坐标 ----
float64 target_x        # 目标 x
float64 target_y        # 目标 y
---
# ---- 响应：任务结果 ----
bool success            # 是否成功接受
string message         # 文字说明
```


### 3.2 更新 turtle_interfaces/CMakeLists.txt


在 `rosidl_generate_interfaces` 里加上 srv 那一行（**最容易漏**）：
```cmake
rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/TurtleStatus.msg"
  "srv/Patrol.srv"          # ← 新增，漏了服务就不会被生成
  DEPENDENCIES builtin_interfaces
)
```


`package.xml` 不用改（依赖没变）。
> 为什么必须登记？因为 `.srv` 也要被 rosidl 翻译成 Python 类和 C++ 头文件。
> 不登记的话，C++ 编译时会报 `patrol.hpp: No such file`。

---

## 4. 第二步：创建第二只海龟（Python 客户端调用 /spawn）

```bash
gedit ~/xwg/turtle_ws/src/py_turtle_control/py_turtle_control/spawn_turtle.py
```


#### 以下是创建第二只小海龟的代码：
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
节点：spawn_turtle —— 调用 turtlesim 自带的 /spawn 服务，创建第二只海龟

这是"客户端"角色的最小示例：
  1) 等服务上线
  2) 发请求（带参数：坐标、角度、名字）
  3) 通过回调处理响应（拿到新海龟的名字）
"""
import rclpy
from rclpy.node import Node
from turtlesim.srv import Spawn      # turtlesim 自带的服务接口

class SpawnTurtle(Node):
    def __init__(self):
        super().__init__('spawn_turtle')

        # 声明参数：新海龟的出生位置和名字
        self.declare_parameter('x', 2.0)
        self.declare_parameter('y', 2.0)
        self.declare_parameter('theta', 0.0)
        self.declare_parameter('name', 'turtle2')

        x = self.get_parameter('x').value
        y = self.get_parameter('y').value
        theta = self.get_parameter('theta').value
        name = self.get_parameter('name').value

        # ---- 创建"客户端"：我要调用别人的服务 ----
        # 参数：服务类型、服务名
        self.client_ = self.create_client(Spawn, '/spawn')

        # ---- 等服务端上线（服务端没启动的话请求会失败）----
        while not self.client_.wait_for_service(timeout_sec=1.0):
            self.get_logger().info('等待 /spawn 服务上线...（请先启动 turtlesim）')

        # ---- 构造请求对象并填字段 ----
        request = Spawn.Request()
        request.x = x
        request.y = y
        request.theta = theta
        request.name = name

        # ---- 发送请求，拿到一个"未来结果" future ----
        self.future_ = self.client_.call_async(request)

        # ---- 关键：给 future 挂一个"完成回调" ----
        # 服务端一回应，rclpy 会在 spin 时自动调用这个回调，无需手动轮询 done()
        #self._spawn_callback 不加括号 = 把函数本身（一个"可调用的东西"）交出去，等以后由别人来调用。
        self.future_.add_done_callback(self._spawn_callback)
        

        self.get_logger().info(f'已发送创建请求：{name} 在 ({x}, {y})')

    def _spawn_callback(self, future):
        """服务端响应后自动触发：解析响应并打印新海龟的名字"""
        try:
            response = future.result()          # 取结果（若服务端报错会抛异常）
            self.get_logger().info(f'创建成功，海龟名字：{response.name}')
        except Exception as e:
            self.get_logger().error(f'服务调用失败：{e}')
        # 拿到结果后主动停掉 spin，main 里的 rclpy.spin 会自然返回
        raise SystemExit

def main(args=None):
    rclpy.init(args=args) #ROS2 Python客户端库的初始化函数
    node = SpawnTurtle()

    # ---- 回调里会 raise SystemExit 结束 spin ----
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
```


### 4.1 关键概念讲解

| 代码 | 讲解 |
|---|---|
| `create_client(Spawn, '/spawn')` | 创建客户端。第一个参数是服务类型（从 .srv 生成），第二个是服务名 |
| `wait_for_service(timeout_sec=1.0)` | 必须等服务端上线。turtlesim 没启动的话，这个服务不存在，直接请求会失败 |
| `Spawn.Request()` | 服务类型里有个内部类 `Request`，实例化后填请求字段 |
| `call_async(request)` | 异步发送，立刻返回一个 future 对象，不阻塞 |
| `future.add_done_callback(cb)` | 给 future 挂"完成回调"。服务端一回应，rclpy 在 spin 时自动调用回调，无需手动轮询 |
| `future.result()` | 拿到响应对象，里面有 `.name` 等响应字段 |
| `rclpy.spin_once(node)` | 持续处理通信事件，直到节点被关闭；回调在 spin 过程中自动触发 |


#### 用future流程
![220_xwg_service](/image/xwg_node/p20-2-1.png)


### 可能产生的疑问：


#### 1.为什么不用`call()` 同步调用？


同步调用会彻底阻塞线程，期间连日志都打不出来。


异步 + 回调是 ROS2 推荐的客户端写法。



#### 2.为什么不用`spin_once` +`while` 轮询？


手写`spin_once` 循环去轮询`future.done()` 也能跑，但属于"忙等待"，既啰嗦又占用 CPU。


注册`add_done_callback` 让 rclpy 在 spin 时自动回调，语义更清晰、更省资源。


#### 3.回调里为什么要`raise SystemExit` ？


`rclpy.spin(node)` 直接返回，配合`main` 里的`try/finally` ，保证节点一定被销毁、`rclpy` 一定被关闭。
如果这个节点之后还要继续发请求，就别 raise，改用标志位或`rclpy.shutdown()` 控制退出。

---


## 5. 第三步：巡逻服务端（Python，闭环控制海龟走路）

```bash
gedit ~/xwg/turtle_ws/src/py_turtle_control/py_turtle_control/patrol_server.py
```


### 以下是patrol_server.py的完整代码
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
节点：patrol_server —— 巡逻服务的【服务端】

它同时扮演三种角色：
  1) 服务端：接收 /patrol 请求（客户端给个坐标）
  2) 订阅者：收听 /turtle2/pose（海龟真实位置）
  3) 发布者：发 /turtle2/cmd_vel（速度指令，让海龟动）

闭环控制逻辑（核心）：
  收位置 → 算误差 → 发速度 → 再看位置 …… 直到到达
"""
import math
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from turtlesim.msg import Pose
from turtle_interfaces.srv import Patrol        # 自定义服务
from turtle_interfaces.msg import TurtleStatus  # 自定义状态


class PatrolServer(Node):
    def __init__(self):
        super().__init__('patrol_server')

        # 参数
        self.declare_parameter('turtle_name', 'turtle2')
        self.declare_parameter('tolerance', 0.2)      # 距离小于这个值就算到达
        self.declare_parameter('max_linear', 2.0)     # 最大前进速度
        self.declare_parameter('max_angular', 2.0)    # 最大转弯速度

        self.turtle_name_ = self.get_parameter('turtle_name').value
        self.tolerance_ = self.get_parameter('tolerance').value
        self.max_linear_ = self.get_parameter('max_linear').value
        self.max_angular_ = self.get_parameter('max_angular').value

        # ---- 服务端：接收巡逻请求 ----
        self.service_ = self.create_service(Patrol, '/patrol', self.patrol_callback)

        # ---- 订阅者：收听 turtle2 位置 ----
        self.pose_sub_ = self.create_subscription(
            Pose, f'/{self.turtle_name_}/pose', self.pose_callback, 10)

        # ---- 发布者：给 turtle2 发速度 ----
        self.cmd_pub_ = self.create_publisher(
            Twist, f'/{self.turtle_name_}/cmd_vel', 10)

        # ---- 发布者：发状态（让 C++ 那边能看到）----
        self.status_pub_ = self.create_publisher(TurtleStatus, '/turtle_status', 10)

        # 巡逻状态
        self.pose_ = None            # 最近一次收到的位置
        self.target_x_ = None        # 目标点
        self.target_y_ = None
        self.patrolling_ = False     # 是否正在巡逻
        self.arrived_ = False        # 是否已到达
        self.count_ = 0

        self.get_logger().info(
            f'巡逻服务端已启动，控制 {self.turtle_name_}，等待 /patrol 请求...')

    # =================================================================
    # 服务回调：客户端请求巡逻时被调用
    #   参数：request（客户端填的请求对象）、response（要返回的响应对象）
    #   必须 return response
    # =================================================================
    def patrol_callback(self, request, response):
        self.target_x_ = request.target_x
        self.target_y_ = request.target_y
        self.patrolling_ = True
        self.arrived_ = False

        self.get_logger().info(
            f'收到巡逻请求：目标 ({request.target_x:.2f}, {request.target_y:.2f})')

        # 重要设计：服务回调【立刻返回】，不在这里阻塞等待到达
        # 原因：回调里死等会卡住 spin，海龟就动不了了（死锁）
        # 真正的移动交给 pose_callback 异步完成
        response.success = True
        response.message = f'已接收巡逻任务，正在前往 ({request.target_x:.2f}, {request.target_y:.2f})'
        return response

    # =================================================================
    # 订阅回调：海龟位置来了，做闭环控制
    # =================================================================
    def pose_callback(self, msg):
        self.pose_ = msg

        # 没在巡逻就发零速度待命
        if not self.patrolling_:
            self.cmd_pub_.publish(Twist())
            return

        # ---- 算误差：目标点 - 当前位置 ----
        dx = self.target_x_ - msg.x
        dy = self.target_y_ - msg.y
        distance = math.hypot(dx, dy)      # 直线距离

        cmd = Twist()

        if distance <= self.tolerance_:    # 到达了
            self.patrolling_ = False
            self.arrived_ = True
            self.cmd_pub_.publish(Twist())  # 发零速度刹车
            self.get_logger().info(f' 已到达目标点，误差 {distance:.3f}')
            return

        # ---- P 控制：误差越大，动作越大 ----
        # 线速度：距离越远走得越快，但不超过上限
        cmd.linear.x = min(self.max_linear_, 1.0 * distance)

        # 角速度：先转向目标，再走
        target_angle = math.atan2(dy, dx)              # 目标方向角
        angle_error = target_angle - msg.theta          # 角度误差
        # 把角度误差归一化到 [-π, π]，避免转远路
        angle_error = math.atan2(math.sin(angle_error), math.cos(angle_error))
        cmd.angular.z = max(-self.max_angular_,
                            min(self.max_angular_, 2.0 * angle_error))

        # 角度误差太大时先原地转，别一边转一边撞墙
        if abs(angle_error) > 0.5:
            cmd.linear.x = 0.0

        self.cmd_pub_.publish(cmd)

        # ---- 定期发布状态 ----
        self.count_ += 1
        if self.count_ % 20 == 0:
            status = TurtleStatus()
            status.turtle_name = self.turtle_name_
            status.x = msg.x
            status.y = msg.y
            status.theta = msg.theta
            status.linear_speed = cmd.linear.x
            status.angular_speed = cmd.angular.z
            status.stamp = self.get_clock().now().to_msg()
            self.status_pub_.publish(status)
            self.get_logger().info(
                f'巡逻中：距目标 {distance:.2f}，角度误差 {angle_error:.2f}')


def main(args=None):
    rclpy.init(args=args)
    node = PatrolServer()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.cmd_pub_.publish(Twist())   # 退出前刹车
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
```

### 5.1 最重要的设计：服务回调为什么立刻返回

> 因为 `rclpy.spin(node)` 是单线程的：它在执行你的回调时，无法同时处理其他回调。

如果服务回调里写个 `while` 死等到海龟到达，那 `pose_callback` 根本没机会执行 →
海龟收不到速度 → 永远到不了 → **死锁**。

> 正确做法：服务回调只"接任务、立刻回复"，真正的移动交给 `pose_callback` 异步做。
> 这是 ROS2 服务编程的核心思维。

### 5.2 闭环控制那几行（精华）

```python
dx = target_x - pose.x           # ① 订阅到位置
dy = target_y - pose.y
distance = hypot(dx, dy)         # ② 算误差
cmd.linear.x = min(2.0, distance)  # ③ 误差 → 控制量（P 控制）
cmd.angular.z = 2.0 * angle_error
cmd_pub.publish(cmd)             # ④ 发布控制，回到①
```

这就是"收反馈 → 算误差 → 发指令"的完整回路，PID、导航、机械臂全是它的加强版。

---

## 6. 第四步：C++ 客户端（产生随机点、请求服务）

```bash
gedit ~/xwg/turtle_ws/src/cpp_status_listener/src/patrol_client.cpp
```


### 以下是patrol_client.cpp完整代码
```cpp
// =====================================================================
// 节点：patrol_client —— C++ 编写的【客户端】
// 干什么：每隔几秒随机生成一个坐标，调用 /patrol 服务让 turtle2 走过去，
//         然后等待服务端响应并打印结果。
//
// C++ 客户端套路（5 步）：
//   第1步 继承 rclcpp::Node
//   第2步 create_client<服务类型>("服务名")
//   第3步 wait_for_service() 等服务端上线
//   第4步 构造 Request、async_send_request() 发送
//   第5步 spin / 等待 future 完成，拿 Response
// =====================================================================

#include <chrono>   // 时间工具库：milliseconds、seconds 等带单位的时间类型，
                    // 配合下面的 _literals 可以用 1s、500ms 这种直观写法
#include <cstdlib>  // C 标准库工具箱：std::rand() 生成随机数、std::srand() 设种子、
                    // RAND_MAX 随机数上限、std::atoi 字符串转数字等
#include <ctime>    // 时间库：std::time() 获取当前时间戳，用来当随机数种子
                    // （类比 Python 的 time 模块，但这里只取时间戳，不 sleep）
#include <memory>   // 智能指针库：提供 std::shared_ptr / std::make_shared，
                    // 让对象内存自动回收，不用手动 delete，避免内存泄漏

#include "rclcpp/rclcpp.hpp"                    // ROS2 的 C++ 客户端库（类比 Python 的 rclpy）
#include "turtle_interfaces/srv/patrol.hpp"      // 自定义服务：patrol.srv 编译后生成的头文件
                                                // .srv → 文件名全小写 + .hpp
#include "turtle_interfaces/msg/turtle_status.hpp"  // 自定义消息：海龟状态，用来订阅 /turtle_status

using std::placeholders::_1;       // std::bind 的占位符，标记"将来收到的第一个参数放这里"
                                   // 不存数据、不运行，纯粹是绑定阶段的标记
using namespace std::chrono_literals;  // "时间字面量开关"：打开后才能写 1s、500ms、2min
                                       // 编译器会自动转成 std::chrono::seconds(1) 等，
                                       // 且带单位类型检查，防止把毫秒当秒用

// 【第1步】继承 rclcpp::Node，把普通 C++ 类注册成 ROS2 节点
class PatrolClient : public rclcpp::Node
{
public:
  // 构造函数：节点启动时执行一次，做初始化
  PatrolClient()
  : Node("patrol_client")   // 节点名，ros2 node list 里显示的名字
  {
    // ---- 声明并读取参数：巡逻间隔（秒）----
    // declare_parameter 告诉 ROS2 "我有个参数叫 interval，默认 8.0"
    // 运行时可通过 --ros-args -p interval:=5 覆盖，不用改代码
    this->declare_parameter<double>("interval", 8.0);
    interval_ = this->get_parameter("interval").as_double();  // 取出参数值转成 double

    // ---- 设置随机数种子 ----
    // 用当前时间戳当种子，保证每次运行生成的随机序列都不一样
    // 不调这行的话，std::rand() 每次运行给出一模一样的序列（伪随机的通病）
    std::srand(static_cast<unsigned>(std::time(nullptr)));

    // 【第2步】创建客户端
    // 模板参数 = 服务类型（由 .srv 生成），函数参数 = 服务名
    // 创建后 client_ 就持有"通往 /patrol 服务端的通道"
    client_ = this->create_client<turtle_interfaces::srv::Patrol>("/patrol");

    // ---- 顺便订阅一下状态（可选，只是打印看看海龟在干嘛）----
    // 模板参数 = 消息类型，参数依次为：话题名、队列长度、回调函数
    // std::bind 把成员函数包装成可调用对象，_1 是占位符，代表将来收到的那条消息
    status_sub_ = this->create_subscription<turtle_interfaces::msg::TurtleStatus>(
      "/turtle_status", 10,
      std::bind(&PatrolClient::status_callback, this, _1));

    // ---- 定时器：每隔 interval_ 秒自动触发一次 timer_callback ----
    // interval_ 是 double（秒），乘 1000 转成毫秒，再转成带单位的时间类型
    // 注意：这里用了 this 指针的定时器版本，回调里可以直接用成员变量
    timer_ = this->create_wall_timer(
      std::chrono::milliseconds(static_cast<int>(interval_ * 1000)),
      std::bind(&PatrolClient::timer_callback, this));

    RCLCPP_INFO(this->get_logger(), "C++ 巡逻客户端已启动，等待服务端...");
  }

private:
  // 定时器回调：每隔 interval_ 秒被自动调用一次
  // 职责：产生随机点 → 等服务端 → 发请求
  void timer_callback()
  {
    // ---- 请求防堆积保护 ----
    // 如果上一次请求还没收到响应（waiting_ 仍为 true），就跳过本次
    // 否则会短时间内发出大量请求，把服务端压垮
    if (waiting_) {
      RCLCPP_INFO(this->get_logger(), "上一次巡逻还没结束，跳过本次请求。");
      return;
    }

    // 【第3步】等服务端上线
    // wait_for_service(1s)：最多等 1 秒。1s 是 C++14 时间字面量（见 using 那行）
    // 服务端没起来（比如 patrol_server 没启动）就打警告并返回，避免请求发飞
    if (!client_->wait_for_service(1s)) {
      RCLCPP_WARN(this->get_logger(), "/patrol 服务未上线，请先启动 patrol_server！");
      return;
    }

    // ---- 生成随机目标点（turtlesim 画布约 11x11，留 1 的边距避免撞墙）----
    // std::rand() 返回 0~RAND_MAX 的整数，除以 RAND_MAX 归一化到 0~1，
    // 再乘 9 加 1，得到 1.0~10.0 的范围
    double x = 1.0 + static_cast<double>(std::rand()) / RAND_MAX * 9.0;
    double y = 1.0 + static_cast<double>(std::rand()) / RAND_MAX * 9.0;

    // 【第4步】构造请求
    // Patrol::Request 是服务类型里的内部类，make_shared 创建智能指针版本
    // （服务端接口期望的是 shared_ptr，所以这里必须这么写）
    auto request = std::make_shared<turtle_interfaces::srv::Patrol::Request>();
    request->target_x = x;   // 填请求字段（对应 .srv 里 --- 上面的部分）
    request->target_y = y;

    RCLCPP_INFO(this->get_logger(), "发起巡逻请求：目标 (%.2f, %.2f)", x, y);

    // 【第4步续】异步发送请求
    // async_send_request 有两个"出口"：
    //   ① 返回值：一个 SharedFuture（本代码没接住，直接丢弃）
    //   ② 回调 lambda：响应到达时由 ROS2 自动调用，并把装着响应的 SharedFuture
    //      作为参数传进来（就是下面 lambda 的 result 参数）
    // 这就是"异步"的含义：发完立刻返回，不等服务端算完，当前线程继续往下走
    waiting_ = true;   // 标记为"等待响应中"，防止定时器再次发请求
    client_->async_send_request(
      request,
      // lambda 参数 result 的类型是 SharedFuture，即"装着响应的 future"
      // result.get() 从中取出真正的响应对象 response
      [this](rclcpp::Client<turtle_interfaces::srv::Patrol>::SharedFuture result) {
        // 【第5步】这个 lambda 在收到响应时自动执行（由 ROS2 的 executor 调用）
        // result.get() 取出响应，里面是 .srv 里 --- 下面的 success 和 message
        auto response = result.get();
        RCLCPP_INFO(this->get_logger(),
          "收到响应：success=%s | %s",
          response->success ? "true" : "false",  // bool 不能直接用 %s，要转成字符串
          response->message.c_str());            // std::string 必须 .c_str() 才能给 %s
        waiting_ = false;   // 关键：重置标志位，允许下一次巡逻请求
                            // 漏了这行客户端会永久卡死在 waiting_=true
      });
    // 注意：lambda 返回后，请求才刚发出去，响应还没到，
    // 程序会继续往下走（这里函数就结束了），响应在 future 某个时刻到达
  }

  // 订阅回调：收到 /turtle_status 时自动调用
  // 参数类型用 ::SharedPtr（智能指针），自动管内存不用 delete
  // msg 是 ROS2 收到的消息对象，不是你创建的，是框架塞给你的
  void status_callback(const turtle_interfaces::msg::TurtleStatus::SharedPtr msg)
  {
    count_++;
    // 海龟状态来得很快（每秒几十次），全打印会刷屏，所以每 40 条打一次
    if (count_ % 40 == 0) {
      RCLCPP_INFO(this->get_logger(),
        "[状态 #%d] %s 位置 x=%.2f y=%.2f 速度 前=%.2f 转=%.2f",
        count_,
        msg->turtle_name.c_str(),  // std::string → %s 必须 .c_str()
        msg->x, msg->y,
        msg->linear_speed, msg->angular_speed);
        // %.2f = 浮点数保留两位；%d = 整数
    }
  }

  // ===== 成员变量（节点持有的资源，必须存住别被回收）=====
  // Client 是客户端类模板，<> 里是服务类型；SharedPtr = 智能指针
  rclcpp::Client<turtle_interfaces::srv::Patrol>::SharedPtr client_;

  // Subscription 是订阅者类模板，<> 里是消息类型
  rclcpp::Subscription<turtle_interfaces::msg::TurtleStatus>::SharedPtr status_sub_;

  // TimerBase 是定时器基类，create_wall_timer 返回的就是它
  rclcpp::TimerBase::SharedPtr timer_;

  bool waiting_ = false;    // 请求防堆积标志：true = 正在等响应，别再发新的
  int count_ = 0;          // 收到消息的计数器，用来降频打印
  double interval_ = 8.0;  // 巡逻间隔（秒），可被参数覆盖
};

// 【程序入口】ROS2 节点的标准 main 写法
int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);                          // 1) 初始化 ROS2 运行时
  auto node = std::make_shared<PatrolClient>();      // 2) 创建节点（智能指针管理生命周期）
  rclcpp::spin(node);                                // 3) 让节点活着：不断检查定时器到没到、
                                                    //    消息来没来，到了就调对应回调
                                                    //    没有这行，程序启动就退出，什么也收不到
  rclcpp::shutdown();                                // 4) Ctrl+C 后收尾，释放资源
  return 0;
}
```

### 6.1 C++ 客户端关键点讲解

| 代码 | 讲解 |
|---|---|
| `create_client<Patrol>("/patrol")` | 创建客户端，尖括号里是服务类型，参数是服务名 |
| `wait_for_service(1s)` | 等服务端上线，`1s` 是 C++14 的时间字面量 |
| `Patrol::Request()` | 服务类型的内部类 `Request`，`std::make_shared` 创建 |
| `async_send_request(请求, 回调)` | 异步发送 + 回调函数，收到响应时自动执行 lambda，不用自己轮询 |
| `result.get()` | 从 future 里取出响应对象 |
| `waiting_` 标志 | 防止上一次还没完成就发下一次（真实项目必须做这个保护） |

> 为什么 C++ 这里可以用回调而不阻塞？
> 因为 `async_send_request` 的第二个参数就是响应回调，
> `spin` 会在响应到达时自动调用它——C++ 的 executor 天然支持这种模式，
> 比 Python 的 `spin_once` 循环更优雅。

---

## 7. 第五步：TF 广播——让 RViz2 看到坐标系跟着动


这一步是**上一篇话题项目里没有的**。核心认知：


> **`/pose` 是数据，`/tf` 是坐标关系。**
> turtlesim 只发 `/pose`，不会自动把它声明成坐标系。
> 这个"桥接"工作必须自己写。


### 7.1 为什么要理解四元数


turtlesim 的 `pose.theta` 是一个**朝向角**（绕 Z 轴转了多少弧度）。
要广播成 TF，必须把它转成**四元数**。四元数的几何含义：


- `w = cos(θ/2)` —— 编码"转了多少"
- `(x, y, z) = 轴方向 × sin(θ/2)` —— 编码"绕哪根轴转"
- turtle2 只在二维平面转，所以只有 **z 分量非零**，x、y 恒为 0


```python
half = theta / 2.0
q.z = sin(half)
q.w = cos(half)
```


### 7.2 tf_broadcaster.py

```bash
gedit ~/xwg/turtle_ws/src/py_turtle_control/py_turtle_control/tf_broadcaster.py
```


#### 以下是tf_broadcaster.py的代码
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
节点：tf_broadcaster —— 一个节点广播两只海龟的 TF
订阅 /turtle1/pose 和 /turtle2/pose
发布 world -> turtle1  和  world -> turtle2  两条变换

核心认知：
  /pose 是"数据"，/tf 是"坐标关系"。
  turtlesim 只发 /pose，不会自动把它声明成坐标系，
  这个"把 pose 翻译成 TF"的桥接工作必须自己写。

为什么一个节点能广播两只海龟？
  因为订阅者的回调可以用 lambda 把海龟名字"绑"进去，
  同一个回调函数靠 turtle_name 参数区分是谁的 pose。
"""
import math     # 数学库：math.sin / math.cos，用来把朝向角转成四元数
import rclpy    # ROS2 的 Python 客户端库
from rclpy.node import Node                        # 节点基类，必须继承
from rclpy.qos import (QoSProfile,               # QoS 配置类（Quality of Service）
                       QoSReliabilityPolicy,      # 可靠性策略：BEST_EFFORT / RELIABLE
                       QoSHistoryPolicy)          # 历史策略：KEEP_LAST / KEEP_ALL
from turtlesim.msg import Pose                    # turtlesim 自带的位置消息
from tf2_ros import TransformBroadcaster          # TF 广播器：负责把变换发出去
from geometry_msgs.msg import TransformStamped    # TF 消息类型：一次变换 = 一个消息


class TFBroadcaster(Node):
    """TF 广播节点：把两只海龟的 pose 转成坐标系变换并发布"""

    def __init__(self):
        # 把普通 Python 类注册成 ROS2 节点，节点名 = 'tf_broadcaster'
        # 不写这句，后面的 create_subscription、get_logger 全部失效
        super().__init__('tf_broadcaster')

        # ---- 声明参数：父坐标系名字，默认 'world' ----
        # 运行时可用 --ros-args -p parent_frame:=map 改成别的（比如 map）
        self.declare_parameter('parent_frame', 'world')
        self.parent_frame_ = self.get_parameter('parent_frame').value

        # ---- 创建 TF 广播器 ----
        # 这是本节点的核心工具，sendTransform 就靠它
        self.br_ = TransformBroadcaster(self)

        # ★ 关键：turtlesim 的 /pose 用 best_effort QoS
        #   订阅者若用默认的 reliable 会静默失败（不报错、收不到数据）
        #
        # 为什么会静默失败？
        #   turtlesim 发布 /pose 时用的是 BEST_EFFORT（宁可丢帧也要实时），
        #   create_subscription 默认用 RELIABLE（必须收到每一条）。
        #   两者不匹配时，订阅者连不上发布者，但 ROS2 不会报错——
        #   表现是：ros2 topic echo /turtle1/pose 能看到数据，
        #           但 TF 里永远缺 turtle1，怎么查都查不出问题。
        # 解决办法：显式指定和发布者一致的 QoS。
        sensor_qos = QoSProfile(
            reliability=QoSReliabilityPolicy.BEST_EFFORT,  # 可靠性：尽力而为
            history=QoSHistoryPolicy.KEEP_LAST,            # 历史策略：只保留最近的
            depth=10,                                     # 队列长度：保留 10 帧
        )

        # ---- 一个节点订阅两个话题，用 lambda 把海龟名字绑进回调 ----
        # lambda msg: self.pose_callback(msg, 'turtle1')
        #   含义：收到消息后，调用 pose_callback，并把 'turtle1' 作为第二个参数传进去
        # 这样同一个回调函数就能区分"这是 turtle1 还是 turtle2 的 pose"
        # （如果不绑名字，回调里根本不知道这条 pose 是谁的）
        self.sub_t1_ = self.create_subscription(
            Pose, '/turtle1/pose',                       # 消息类型 + 话题名
            lambda msg: self.pose_callback(msg, 'turtle1'),  # 回调（带名字）
            sensor_qos)                                  # QoS 配置

        self.sub_t2_ = self.create_subscription(
            Pose, '/turtle2/pose',
            lambda msg: self.pose_callback(msg, 'turtle2'),
            sensor_qos)

        # 节点启动提示
        self.get_logger().info(
            f'TF 广播器已启动：{self.parent_frame_} -> turtle1 / turtle2')

    def pose_callback(self, msg: Pose, turtle_name: str):
        """
        订阅回调：每次收到某只海龟的 pose 就调用一次
        msg          —— 收到的 Pose 消息（含 x, y, theta）
        turtle_name  —— lambda 绑进来的名字（'turtle1' 或 'turtle2'）
        """
        # ---- 构造一条变换消息 ----
        t = TransformStamped()

        # 时间戳：告诉别人"这个变换是哪一刻的"，RViz2 靠它做插值
        t.header.stamp = self.get_clock().now().to_msg()

        # 父帧（坐标系树的根方向）：所有海龟都挂在它下面
        t.header.frame_id = self.parent_frame_   # 'world'

        # 子帧（这只海龟自己的坐标系）
        t.child_frame_id = turtle_name           # 'turtle1' 或 'turtle2'

        # ---- 平移部分：海龟在 world 里的位置 ----
        t.transform.translation.x = msg.x
        t.transform.translation.y = msg.y
        t.transform.translation.z = 0.0          # 海龟在二维平面运动，Z 恒为 0

        # ---- 旋转部分：朝向角 theta → 四元数 ----
        # 为什么不能直接用 theta？
        #   TF 要求旋转用四元数表示，而 turtlesim 给的是"绕 Z 轴转了多少度"。
        #   转换公式（只绕 Z 轴，所以 x、y 恒为 0）：
        #     q.z = sin(θ/2)
        #     q.w = cos(θ/2)
        #   几何含义：w 编码"转了多少"，(x,y,z) 编码"绕哪根轴转"
        half = msg.theta / 2.0
        t.transform.rotation.x = 0.0
        t.transform.rotation.y = 0.0
        t.transform.rotation.z = math.sin(half)
        t.transform.rotation.w = math.cos(half)

        # ---- 发布这条变换 ----
        # 发布后，ros2 topic echo /tf 就能看到这条记录，
        # RViz2 里也会出现对应的坐标系箭头
        self.br_.sendTransform(t)


def main():
    """程序入口"""
    rclpy.init()                          # 1) 初始化 ROS2
    node = TFBroadcaster()                # 2) 创建节点
    rclpy.spin(node)                      # 3) 持续运转：有 pose 来就调回调，不断广播
    node.destroy_node()                   # 4) 释放资源
    rclpy.shutdown()                      # 5) 关闭 rclpy


if __name__ == '__main__':
    main()
```


### 7.3 QoS 这个坑必须讲清


这是本篇最容易踩的坑，值得单独说：

```python
sensor_qos = QoSProfile(
    reliability=QoSReliabilityPolicy.BEST_EFFORT, ...)
```

- turtlesim 的 `/pose` 用的是 **best_effort**（宁可丢帧也要实时）
- `create_subscription` 默认用 **reliable**（必须收到每一条）
- **两者不兼容时，订阅静默失败**：不报错、不回调、日志里什么都没有

现象就是：`/turtle1/pose` 话题明明有数据，`ros2 topic echo` 也能看到，
但 TF 里永远只有 turtle2，turtle1 死活不出来。

> 判断技巧：launch 崩溃时那一大屏红字，90% 都是"多米诺骨牌"式的连锁反应，
> 真正的源头永远是**第一个 `[ERROR] [launch]`**。

---


## 8. 第六步：launch 一键拉起

### 8.1 turtles_patrol.launch.py

```bash
mkdir -p ~/xwg/turtle_ws/src/py_turtle_control/launch
gedit ~/xwg/turtle_ws/src/py_turtle_control/launch/turtles_patrol.launch.py
```

#### 以下是turtles_patrol.launch.py代码
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
launch/turtles_patrol.launch.py
一键拉起：turtlesim + turtle1转圈 + 创建turtle2 + turtle2随机巡逻 + TF广播

启动顺序（有依赖关系，不能随意调换）：
  ① turtlesim_node     模拟器（必须先起，提供服务 /spawn 和话题 /pose、/cmd_vel）
  ② spawn_turtle       生出海龟 turtle2（依赖 ① 的 /spawn 服务）
  ③ patrol_server      巡逻服务端（订阅 pose、发布 cmd_vel、提供 /patrol 服务）
  ④ patrol_client      C++ 客户端（定时发随机目标点）
  ⑤ turtle_circle      turtle1 转圈
  ⑥ tf_broadcaster     广播两只海龟的 TF（依赖 ①② 的 /pose 话题）

其中 ②⑥ 用 TimerAction 延迟 3 秒，保证 ① 的服务和话题已经注册完成。
"""


# ============================================================
# 一、导入区
# ============================================================

# LaunchDescription：launch 文件的"根容器"，
# 所有要启动的节点、延时、事件处理器都装在这个对象里返回。
from launch import LaunchDescription

# TimerAction：延时动作。
# 作用：等 N 秒后再启动某个节点，用来解决"依赖的服务还没准备好"的问题。
from launch.actions import TimerAction

# Node：描述"一个要启动的 ROS2 节点"。
# 对应命令行里的：ros2 run <package> <executable>
from launch_ros.actions import Node


# ============================================================
# 二、固定函数名：generate_launch_description
# ============================================================
# 注意：函数名必须是这个，不能改！
# ros2 launch 会自动调用这个函数，拿到 LaunchDescription 对象。
# 如果改名，launch 会报 "generate_launch_description" not found。

def generate_launch_description():

    # =========================================================
    # 节点 ①：turtlesim 模拟器
    # =========================================================
    # 这是整个系统的"地基"，必须第一个启动。
    # 它起来之后才会提供：
    #   - /spawn 服务（生海龟）
    #   - /turtle1/pose、/turtle2/pose 话题
    #   - /turtle1/cmd_vel、/turtle2/cmd_vel 话题
    turtlesim_node = Node(
        package='turtlesim',         # 包名（ros2 pkg list 里看到的）
        executable='turtlesim_node', # 可执行文件名（包里 entry_point / install 里的名字）
        name='turtlesim',           # 节点名（ros2 node list 里显示的名字，可自定义）
        output='screen',            # 日志打印到屏幕（默认是 log 文件，看不到实时输出）
    )

    # =========================================================
    # 节点 ②：spawn_turtle —— 创建第二只海龟 turtle2
    # =========================================================
    # 依赖关系：必须等 ① 起来，否则 /spawn 服务不存在会失败。
    # 解决办法：不直接放进 LaunchDescription，
    #          而是用 TimerAction 包一层，延迟 3 秒再启动（见下方 return 部分）。
    spawn_turtle = Node(
        package='py_turtle_control',  # 你的 Python 包
        executable='spawn_turtle',    # setup.py 里 entry_points 注册的名字
        name='spawn_turtle',          # 节点名
        output='screen',              # 日志输出到屏幕

        # parameters：给节点传参数，等价于命令行 --ros-args -p x:=2.0
        # 这些参数在节点里用 declare_parameter() 接收。
        # 这里把海龟出生位置写死在 (2, 2)，面向 0 弧度，名字叫 turtle2。
        parameters=[{
            'x': 2.0,       # 出生 x 坐标
            'y': 2.0,       # 出生 y 坐标
            'theta': 0.0,   # 出生朝向（弧度）
            'name': 'turtle2',  # 海龟名字，也是后续话题名 /turtle2/pose 的来源
        }],
    )

    # =========================================================
    # 节点 ③：patrol_server —— 巡逻服务端（核心控制节点）
    # =========================================================
    # 它同时扮演三种角色：
    #   A. 服务端：提供 /patrol 服务，接收"去 (x,y)"的请求
    #   B. 订阅者：订阅 /turtle2/pose 获取海龟实时位置
    #   C. 发布者：发布 /turtle2/cmd_vel 让海龟动起来
    # 控制逻辑：收位置 → 算误差 → 发速度 → 循环，直到距离 < tolerance
    patrol_server = Node(
        package='py_turtle_control',
        executable='patrol_server',
        name='patrol_server',
        output='screen',
        parameters=[{
            'turtle_name': 'turtle2',  # 控制哪只海龟（决定订阅/发布哪个话题）
            'tolerance': 0.2,          # 到达阈值：距离 < 0.2 就算到了
            'max_linear': 2.0,         # 最大前进速度（防止撞墙）
            'max_angular': 2.0,        # 最大角速度（防止转太快）
        }],
    )

    # =========================================================
    # 节点 ④：patrol_client —— C++ 客户端（随机点生成器）
    # =========================================================
    # 行为：每隔 interval 秒，随机生成一个坐标 (x,y)，
    #       然后调用 /patrol 服务，让服务端把海龟送过去。
    # 它自己不动海龟，只负责"下命令"。
    patrol_client = Node(
        package='cpp_status_listener',  # 这个可执行文件在 C++ 包里
        executable='patrol_client',     # CMakeLists.txt 里 add_executable 的名字
        name='patrol_client',
        output='screen',
        parameters=[{
            'interval': 8.0,   # 每隔 8 秒发一次巡逻请求
        }],
    )

    # =========================================================
    # 节点 ⑤：turtle_circle —— turtle1 转圈
    # =========================================================
    # 就是你的第一个项目的节点，让 turtle1 绕圈。
    # 它和 turtle2 的巡逻互不干扰，各自发各自的 cmd_vel。
    turtle_circle = Node(
        package='py_turtle_control',
        executable='turtle_circle',
        name='turtle_circle',
        output='screen',
        # 这里没传参数，说明节点内部用了默认值（比如半径、线速度写死在代码里）
    )

    # =========================================================
    # 节点 ⑥：tf_broadcaster —— TF 广播器
    # =========================================================
    # 作用：订阅 /turtle1/pose 和 /turtle2/pose，
    #       发布 world -> turtle1 和 world -> turtle2 两条坐标变换。
    # RViz2 里看到的坐标系箭头就是它广播出来的。
    # 依赖：必须等 ①② 起来、/pose 话题有数据之后才有意义。
    tf_broadcaster = Node(
        package='py_turtle_control',
        executable='tf_broadcaster',
        name='tf_broadcaster',
        output='screen',
        parameters=[{
            'parent_frame': 'world',  # TF 树的根帧名字
        }],
    )

    # =========================================================
    # 三、组装 LaunchDescription 并返回
    # =========================================================
    # 关键原则：每个 Node 变量只能出现一次！
    #   要么直接放进列表，要么包进 TimerAction，不能两边都写。
    #   重复加入会报 "executed more than once"。
    #
    # 注意：列表里的顺序 ≠ 启动顺序！
    #   ROS2 launch 会并发启动列表里所有"没有依赖约束"的节点。
    #   有依赖的节点必须用 TimerAction 显式约束。
    return LaunchDescription([

        # ① 立即启动模拟器（地基，必须先起）
        turtlesim_node,

        # ② + ⑥：3 秒后一起启动
        #   spawn_turtle 依赖 /spawn 服务（需要 ① 先起）
        #   tf_broadcaster 依赖 /pose 话题（需要 ① 先起，且 ② 创建 turtle2 后才有 /turtle2/pose）
        # TimerAction 的作用：
        #   period    —— 延迟时间（秒），这里给模拟器留足启动时间
        #   actions   —— 延迟后要执行的动作列表，可以放多个 Node
        # 为什么不用 OnProcessStart 事件？
        #   因为 OnProcessStart 触发太早（进程刚 fork，服务还没注册），
        #   用固定延时更稳妥、日志也更干净。
        TimerAction(period=3.0, actions=[spawn_turtle, tf_broadcaster]),

        # ③ 巡逻服务端（内部有 wait_for_service 重试保护，不怕稍晚一点）
        patrol_server,

        # ④ 巡逻客户端（内部也有 wait_for_service 保护）
        patrol_client,

        # ⑤ turtle1 转圈（和 turtle2 无关，随时可起）
        turtle_circle,
    ])
```

### 8.2 setup.py 必须注册新节点


先在setup.py执行以下操作：
```python
entry_points={
    'console_scripts': [
        'turtle_circle  = py_turtle_control.turtle_circle:main',
        'spawn_turtle   = py_turtle_control.spawn_turtle:main',
        'patrol_server  = py_turtle_control.patrol_server:main',
        'tf_broadcaster = py_turtle_control.tf_broadcaster:main',  # ← 新增
    ],
},
```


之后在setup.py继续进行操作：
```python
import os  #添加到开头部分

#找到data_filds这个列表
data_files=[
    ('share/ament_index/resource_index/packages',
     ['resource/' + package_name]),
    ('share/' + package_name, ['package.xml']), #1、2 行是 ros2 pkg create 自带的基础配置
    ('share/' + package_name + '/launch',    #
     [os.path.join('launch', f)
      for f in os.listdir('launch')
      if f.endswith('.launch.py')]),
],
```
这三行是"安装清单"：'data_files' 每一行都是 (装到哪, 装什么) 的配对。第 3 行用"列表推导式"自动扫描 'launch/' 目录、只挑 '.launch.py' 结尾的文件装进 'install/share/包名/launch/'，这样以后新增 'launch' 文件不用改 'setup.py'。


### 8.3 cpp下CMakeLists.txt 追加第二个可执行文件


分别加在之前的后面：
```cmake
# 第二个可执行文件：巡逻客户端
add_executable(status_listener src/status_listener.cpp)
add_executable(patrol_client src/patrol_client.cpp)  #<-新增（有注释加到前面注释下面

ament_target_dependencies(status_listener rclcpp turtle_interfaces)
ament_target_dependencies(patrol_client rclcpp turtle_interfaces)  #<-新增

install(TARGETS status_listener DESTINATION lib/${PROJECT_NAME})
install(TARGETS patrol_client DESTINATION lib/${PROJECT_NAME})  #<-新增
```

---


## 9. 编译

```bash
cd ~/xwg/turtle_ws
source /opt/ros/humble/setup.bash
colcon build
source install/setup.bash
```

看到 `Summary: 3 packages finished` 就成功了。


### 验证服务接口生成成功：
```bash
ros2 interface show turtle_interfaces/srv/Patrol
```
能看到上下两部分（请求 + 响应）就对了。

---


## 10. 运行与 TF 可视化


### 10.1 一键启动

```bash
ros2 launch py_turtle_control turtles_patrol.launch.py
```

你会看到：
- turtle1 在转圈
- 3 秒后 turtle2 出现
- 终端打印：`收到巡逻请求：目标 (x, y)` → `巡逻中：距目标 ...` → `已到达目标点`
- turtle2 每 8 秒换一个点随机走


![858-xwg_service](/image/xwg_node/p20-2.png)



### 10.2 验证两只海龟的 TF 都在

```bash
ros2 topic echo /tf
```

应该同时看到 `child_frame_id: turtle1` 和 `child_frame_id: turtle2`，
且坐标都在实时变化。


### 10.3 RViz2 里看坐标系跟着动

```bash
rviz2
```

配置（按顺序点）：
1. 左侧 **Global Options → Fixed Frame** 改成 **`world`**
2. 左下角 **Add → TF → OK**
3. TF 设置里勾选：
   - Show Axes（看红绿蓝三根轴）
   - Show Names（看名字）
   - Show Arrows（看父子连线）
   - **Marker Scale = 1**

效果：两只海龟各自带一个坐标轴，turtle2 移动时它的轴会**平移 + 旋转**跟着动。
![887-xwg_service](/image/xwg_node/p20-3-1.png)



### 10.4 顺手补一个 world 根帧（可选但规范）

`world` 这个根帧默认是隐式的，规范做法是显式发出来：

```bash
ros2 run tf2_ros static_transform_publisher 0 0 0 0 0 0 map world
```

然后 RViz2 里 **Fixed Frame 改成 `map`**，整条链变成：

```
map          ← 真正的根（由 static_transform_publisher 显式发布）
 └── world   ← turtlesim 的坐标原点
      ├── turtle1
      └── turtle2
```

这是 ROS 里最规范的写法。

---


## 11. 调试命令速查

```bash
ros2 service list                    # 应看到 /spawn、/patrol 等
ros2 service type /patrol            # 查看服务类型
ros2 service call /patrol turtle_interfaces/srv/Patrol "{target_x: 8.0, target_y: 8.0}"
                                    # 手动调一次服务，不用客户端也能测
ros2 node list                       # 应看到 patrol_server、patrol_client 等
rqt_graph                            # 看节点和话题/服务的连线
ros2 topic echo /tf                  # 看两只海龟的坐标变换
ros2 run tf2_tools view_frames       # 把 TF 树导出成 frames.pdf
```

> `ros2 service call` 这条特别有用——服务端写好后，不用等客户端就能单独验证它对不对。

---


## 12. 两个最容易踩的坑

1. **服务回调里千万别死等**（会死锁，海龟不动）。
   记住：服务回调只接任务立刻返回，异步任务交给话题回调。

2. **别忘了在 `rosidl_generate_interfaces` 里登记 `srv/Patrol.srv`**，
   漏了服务类型就生成不出来，C++ 会报 `patrol.hpp: No such file`。

3. **订阅 `/pose` 必须显式指定 `best_effort` QoS**，
   否则 turtle1 的 TF 会静默丢失（本篇最大坑）。

4. **launch 里每个 Node 变量只能出现一次**，
   重复加入会报 `executed more than once`。

5. **`setup.py` 里 `data_files` 不能重复定义**，
   否则 `colcon build` 直接失败，launch 文件也注册不进去。

---

## 13. 回头看：话题 vs 服务，到底怎么选

做完这两个项目，你应该有体感了：

- **turtle1 转圈** → 用话题。速度指令是持续流，谁爱听谁听，不需要回应。
- **turtle2 巡逻** → 用服务。"去 (8, 8)" 是一个任务，客户端必须知道"到了没有"。

选型口诀：

> **持续的数据用话题，一次性的任务用服务。**

而 **TF** 是这两者的"空间层"——它不负责传业务数据，
只负责回答一个问题：**"某个坐标系，此刻在世界里的哪个位置、什么朝向？"**

---

## 14. 下一步可以做什么

1. 把 **Action** 加进来：巡逻这种"长时间任务"其实更适合 Action（自带取消 + 进度反馈）。
2. 给 launch 加**条件参数**：`ros2 launch ... interval:=5` 动态改巡逻间隔。
3. 用 `tf2_geometry_msgs` 做**坐标变换计算**：比如算两只海龟之间的距离。
