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

#include <chrono>  // 引入"时间"相关的工具
#include <cstdlib>// 引入"通用工具"：随机数、字符串转数字、程序退出等
#include <ctime>  // 类似python time
#include <memory> // 回收内存

#include "rclcpp/rclcpp.hpp"
#include "turtle_interfaces/srv/patrol.hpp"
#include "turtle_interfaces/msg/turtle_status.hpp"

using std::placeholders::_1;
using namespace std::chrono_literals;  //using namespace std::chrono_literals; 是"时间字面量开关"——打开后就能用 500ms、1s、2min 这种直观写法替代 

class PatrolClient : public rclcpp::Node
{
public:
  PatrolClient()
  : Node("patrol_client")
  {
    this->declare_parameter<double>("interval", 8.0);
    interval_ = this->get_parameter("interval").as_double();

    std::srand(static_cast<unsigned>(std::time(nullptr)));

    // 【第2步】创建客户端
    client_ = this->create_client<turtle_interfaces::srv::Patrol>("/patrol");

    // 顺便订阅一下状态
    status_sub_ = this->create_subscription<turtle_interfaces::msg::TurtleStatus>(
      "/turtle_status", 10,
      std::bind(&PatrolClient::status_callback, this, _1));

    // 定时器：每隔 interval_ 秒触发一次巡逻请求
    timer_ = this->create_wall_timer(
      std::chrono::milliseconds(static_cast<int>(interval_ * 1000)),
      std::bind(&PatrolClient::timer_callback, this));

    RCLCPP_INFO(this->get_logger(), "C++ 巡逻客户端已启动，等待服务端...");
  }

private:
  // 定时器回调：产生随机点并发起服务请求
  void timer_callback()
  {
    // 如果上一次请求还没完成，就跳过这次（避免堆积）
    if (waiting_) {
      RCLCPP_INFO(this->get_logger(), "上一次巡逻还没结束，跳过本次请求。");
      return;
    }

    // 【第3步】等服务端上线
    if (!client_->wait_for_service(1s)) {
      RCLCPP_WARN(this->get_logger(), "/patrol 服务未上线，请先启动 patrol_server！");
      return;
    }

    // ---- 生成随机目标点（turtlesim 画布约 11x11）----
    double x = 1.0 + static_cast<double>(std::rand()) / RAND_MAX * 9.0;
    double y = 1.0 + static_cast<double>(std::rand()) / RAND_MAX * 9.0;

    // 【第4步】构造请求
    auto request = std::make_shared<turtle_interfaces::srv::Patrol::Request>();
    request->target_x = x;
    request->target_y = y;

    RCLCPP_INFO(this->get_logger(), "发起巡逻请求：目标 (%.2f, %.2f)", x, y);

    // 异步发送，返回一个 future
    waiting_ = true;
    client_->async_send_request(
      request,
      [this](rclcpp::Client<turtle_interfaces::srv::Patrol>::SharedFuture result) {
        // 【第5步】这个 lambda 在收到响应时自动执行
        auto response = result.get();
        RCLCPP_INFO(this->get_logger(),
          "收到响应：success=%s | %s",
          response->success ? "true" : "false",
          response->message.c_str());
        waiting_ = false;
      });
  }

  // 订阅回调：看看海龟当前状态
  void status_callback(const turtle_interfaces::msg::TurtleStatus::SharedPtr msg)
  {
    count_++;
    if (count_ % 40 == 0) {
      RCLCPP_INFO(this->get_logger(),
        "[状态 #%d] %s 位置 x=%.2f y=%.2f 速度 前=%.2f 转=%.2f",
        count_, msg->turtle_name.c_str(),
        msg->x, msg->y,
        msg->linear_speed, msg->angular_speed);
    }
  }

  rclcpp::Client<turtle_interfaces::srv::Patrol>::SharedPtr client_;
  rclcpp::Subscription<turtle_interfaces::msg::TurtleStatus>::SharedPtr status_sub_;
  rclcpp::TimerBase::SharedPtr timer_;
  bool waiting_ = false;
  int count_ = 0;
  double interval_ = 8.0;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<PatrolClient>();
  rclcpp::spin(node);
  rclcpp::shutdown();
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
"""
import math
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, QoSReliabilityPolicy, QoSHistoryPolicy
from turtlesim.msg import Pose
from tf2_ros import TransformBroadcaster
from geometry_msgs.msg import TransformStamped


class TFBroadcaster(Node):
    def __init__(self):
        super().__init__('tf_broadcaster')

        self.declare_parameter('parent_frame', 'world')
        self.parent_frame_ = self.get_parameter('parent_frame').value

        self.br_ = TransformBroadcaster(self)

        # ★ 关键：turtlesim 的 /pose 用 best_effort QoS
        #   订阅者若用默认的 reliable 会静默失败（不报错、收不到数据）
        sensor_qos = QoSProfile(
            reliability=QoSReliabilityPolicy.BEST_EFFORT,
            history=QoSHistoryPolicy.KEEP_LAST,
            depth=10,
        )

        # 一个节点订阅两个话题，用 lambda 把海龟名字绑进回调
        self.sub_t1_ = self.create_subscription(
            Pose, '/turtle1/pose',
            lambda msg: self.pose_callback(msg, 'turtle1'),
            sensor_qos)

        self.sub_t2_ = self.create_subscription(
            Pose, '/turtle2/pose',
            lambda msg: self.pose_callback(msg, 'turtle2'),
            sensor_qos)

        self.get_logger().info(
            f'TF 广播器已启动：{self.parent_frame_} -> turtle1 / turtle2')

    def pose_callback(self, msg: Pose, turtle_name: str):
        t = TransformStamped()
        t.header.stamp = self.get_clock().now().to_msg()
        t.header.frame_id = self.parent_frame_   # 父帧：world
        t.child_frame_id = turtle_name           # 子帧：turtle1 或 turtle2

        # 平移
        t.transform.translation.x = msg.x
        t.transform.translation.y = msg.y
        t.transform.translation.z = 0.0

        # 旋转：朝向角 → 四元数（只绕 Z 轴）
        half = msg.theta / 2.0
        t.transform.rotation.x = 0.0
        t.transform.rotation.y = 0.0
        t.transform.rotation.z = math.sin(half)
        t.transform.rotation.w = math.cos(half)

        self.br_.sendTransform(t)


def main():
    rclpy.init()
    node = TFBroadcaster()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


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
"""
from launch import LaunchDescription
from launch.actions import TimerAction
from launch_ros.actions import Node


def generate_launch_description():

    turtlesim_node = Node(
        package='turtlesim', executable='turtlesim_node',
        name='turtlesim', output='screen')

    spawn_turtle = Node(
        package='py_turtle_control', executable='spawn_turtle',
        name='spawn_turtle', output='screen',
        parameters=[{'x': 2.0, 'y': 2.0, 'theta': 0.0, 'name': 'turtle2'}])

    patrol_server = Node(
        package='py_turtle_control', executable='patrol_server',
        name='patrol_server', output='screen',
        parameters=[{'turtle_name': 'turtle2',
                     'tolerance': 0.2,
                     'max_linear': 2.0,
                     'max_angular': 2.0}])

    patrol_client = Node(
        package='cpp_status_listener', executable='patrol_client',
        name='patrol_client', output='screen',
        parameters=[{'interval': 8.0}])

    turtle_circle = Node(
        package='py_turtle_control', executable='turtle_circle',
        name='turtle_circle', output='screen')

    tf_broadcaster = Node(
        package='py_turtle_control', executable='tf_broadcaster',
        name='tf_broadcaster', output='screen',
        parameters=[{'parent_frame': 'world'}])

    #  关键原则：每个 Node 变量只能出现一次！
    # 要么直接放进列表，要么包进 TimerAction，不能两边都写。
    return LaunchDescription([

        # ① 立即启动模拟器
        turtlesim_node,

        # ② spawn + tf：3 秒后一起启动
        #    spawn 依赖 /spawn 服务，tf 依赖 /pose 话题，都需要等 turtlesim 起来
        TimerAction(period=3.0, actions=[spawn_turtle, tf_broadcaster]),

        # ③ 巡逻服务端
        patrol_server,

        # ④ 巡逻客户端
        patrol_client,

        # ⑤ turtle1 转圈
        turtle_circle,
    ])
```

### 8.2 setup.py 必须注册新节点

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

并且 `data_files` **只能有一个**（重复定义会直接让 `colcon build` 失败）：

```python
data_files=[
    ('share/ament_index/resource_index/packages',
     ['resource/' + package_name]),
    ('share/' + package_name, ['package.xml']),
    ('share/' + package_name + '/launch',
     [os.path.join('launch', f)
      for f in os.listdir('launch')
      if f.endswith('.launch.py')]),
],
```

### 8.3 CMakeLists.txt 追加第二个可执行文件

```cmake
# 第二个可执行文件：巡逻客户端
add_executable(patrol_client src/patrol_client.cpp)
ament_target_dependencies(patrol_client rclcpp turtle_interfaces)
install(TARGETS patrol_client DESTINATION lib/${PROJECT_NAME})
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
