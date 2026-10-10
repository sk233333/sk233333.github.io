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


[xwg_project13](https://github.com/sk233333/xwg_project)


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
![ros2xwg35](/image/xwg_node/p1-1.png)


### 现在顺便看一眼海龟有哪些话题（这一步很重要！！）保持之前窗口运行，新开一个窗口 
```bash
ros2 topic list
```
看看有没有/turtle1/cmd_vel 和 /turtle1/pose 


#### 1.我们先看cmd_vel(发给海龟的速度指令： 
看它的数据格式： 
```bash
ros2 topic info /turtle1/cmd_vel -v
```
![ros2xwg49行](/image/xwg_node/p2-1.png)


滑到第一行Type会显示：Type: geometry_msgs/msg/Twist （Twist是我们写代码要import的类型


##### 让我们看看它字段长什么样： 
```bash
ros2 interface show geometry_msgs/msg/Twist
```


![ros2xwg62行](/image/xwg_node/p2-2.png)


Vector3  linear float64 x float64 y float64 z （xyz方向线速度


Vector3  angular float64 x float64 y float64 z （xyz方向加速度


#### 2.我们再看pose（使用pose,海龟会报出自己真实位置


看它的数据格式：
```bash
ros2 topic info /turtle1/pose -v
```


![ros2xwg81](/image/xwg_node/p2-3.png)


滑到前面Type会显示：Topic type: turtlesim/msg/Pose （Pose是我们写代码要import的类型


让我们看看字段长什么样：
```bash
ros2 interface show turtlesim/msg/Pose
```


![ros2xwg93](/image/xwg_node/p2-4.png)


float32 x float32 y（海龟在仿真窗口中的二维坐标位置（单位通常视为米）turtlesim默认窗口坐标大致是x:0~11.08，y:0~11.08。左下角为 (0,0)，右上角为最大值。


theta(海龟的朝向角（偏航角），单位是弧度（rad）theta=0表示头朝正右方（X轴正向）。逆时针旋转为正，顺时针为负，范围通常在-π~π之间。


float32 linear_velocity （线速度（前进/后退的速度），单位 m/s，正值表示向前游，负值表示向后退，如果静止则为 0.0。


float32 angular_velocity （角速度（原地旋转的速度），单位 rad/s，正值表示逆时针转，负值表示顺时针转。


## 3.建立三个包（~/xwg/turtle_ws/src$ 在这个地址下创建包


建立项目文件夹,并进入src终端
```bash
mkdir -p ~/xwg/turtle_ws/src
cd ~/xwg/turtle_ws/src
```


### 格式讲解：ros2 pkg creat + 功能包名字 +  构建系统类型 + 开源许可证


#### 1.ros2 pkg creat本质上是在当前目录（或指定路径）下生成package.xml，生成CMakeLists.txt（或 setup.py，取决于构建类型）创建基本目录结构。


#### 2.功能包名字：只能有小写字母 + 数字 + 下划线组成  例：abc_123


#### 3.构建系统类型(就是问包要用什么语言写的：分为三类


1.ament_cmake C++ / 接口包 


2.ament_python Python

    
3.cmake 纯 CMake（不推荐,一般非ros项目使用）


#### 4.开源许可证


指定开源许可证，会写入 package.xml

    
常见选项：1. Apache-2.0（商业友好） 2. MIT（最宽松） 3. BSD-3-Clause 4. GPL-3.0（传染性开源）

    
为什么要写这个：ROS 2 生态非常强调许可证

    
为什么要加license?: 1. 很多公司/高校项目 强制要求明确 license 2. 不写 license 默认是“保留所有权利”，别人不能合法使用。


#### 了解完格式之后我们来建立包


1.建立接口包
```bash
ros2 pkg create turtle_interfaces --build-type ament_cmake --license Apache-2.0
```
  

2.发布者包-Python控制节点（主力）
```bash
ros2 pkg create py_turtle_control --build-type ament_python --dependencies rclpy --license Apache-2.0
```

  
3.订阅节包-c++
```bash
ros2 pkg create cpp_status_listener --build-type ament_cmake --dependencies rclcpp --license Apache-2.0
```
	

![ros2xwg175](/public/image/xwg_node/p3-1.png)


确认目录下有三个包之后给接口包加一个msg目录：
```bash
mkdir -p ~/xwg/turtle_ws/src/turtle_interfaces/msg
```


## 4.接口包下写自定义接口


### 为什么要自定义？：​ 因为海龟自带的Pose只有位置和速度，没有"名字"。我们想让C++那边收到的消息更完整一点，就得自己造一个。


```bash
gedit ~/xwg/turtle_ws/src/turtle_interfaces/msg/TurtleStatus.msg
```
gedit概念：使用图形化文本编辑器，打开（如果不存在则自动创建）这个路径下的 TurtleStatus.msg 文件


```msg
# 海龟状态报告（我们自己定义的数据格式）
# 规则：文件名首字母大写驼峰 + .msg；一行一个字段；# 是注释
# 这个文件会被 rosidl 自动翻译成 Python 类和 C++ 头文件，
# 所以 Python 和 C++ 能"说同一种语言"

string turtle_name          # 海龟名字
float64 x                   # x 坐标
float64 y                   # y 坐标
float64 theta               # 朝向
float64 linear_speed        # 当前前进速度
float64 angular_speed       # 当前转弯速度
builtin_interfaces/Time stamp   # 时间戳
#builtin_interfaces 是 ROS 2 官方提供的内置包，专门存放基础时间类型。
#Time 是这个包里的一个标准消息，它本身只包含两个部分：int32 sec（秒）和 uint32 nanosec（纳秒），精度极高。
#stamp：这是你定义的字段名称（变量名）。
```


## 5.修改接口包下文件（turtle_interfaces


### 为什么要修改呢？


1.去掉冗余：删除默认的编译器警告选项和测试代码（接口包通常不需要）。


2.加入核心：必须手动加入“消息生成器”和“消息登记”逻辑，否则编译后其他包根本找不到这个消息。


3.把我们的自定义接口和其他包建立依赖（"用别人的"就必须"告诉系统你用了谁的"——这就是依赖，例：C语言导入文件。


### 1修改CMakeLists.txt


#### 删除了


if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang") （纯接口包不编译可执行程序，这些警告选项没意义

	
if(BUILD_TESTING) (接口包通常不需要 lint / 单元测试，简化后避免版权头检查报错

	
ament_export_include_directories(include) 你的接口包没有 include/ 目录（没有手写 C++ 头文件），不需要导出

	
ament_export_libraries（原文件第11行）接口包不编译 .so 库文件，这行是占位符，删掉正确

	
install(TARGETS my_library EXPORT export_${PROJECT_NAME}) 有可执行文件/库要安装，删掉正确

	
ament_export_targets(export_${PROJECT_NAME}) 没有自定义 CMake target 要导出，删掉正确

	
#### 新增


find_package(rosidl_default_generators REQUIRED) 加载消息生成器

	
find_package(builtin_interfaces REQUIRED)	加载时间类型依赖

	
rosidl_generate_interfaces(...) 登记并生成 .msg 代码

	
DEPENDENCIES builtin_interfaces 保证编译顺序

	
ament_export_dependencies(rosidl_default_runtime) 导出运行时依赖给下游


### 完整的CMakeLists.txt文本：
```txt
cmake_minimum_required(VERSION 3.8)
project(turtle_interfaces)
#声明 CMake 最低版本和项目名称（必须保留）

find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)  # 接口翻译器
find_package(builtin_interfaces REQUIRED)         # 因为 msg 里用了 Time
#find_package：告诉 CMake：“请帮我找到 XXX 这个库/包，并把它的头文件、库文件、CMake 工具都准备好，让我后面能用。
#REQUIRED = 这个包必须找到，找不到就直接报错停止编译，不要继续了。如果不加 只给一个警告，编译继续，后面用到时莫名其妙失败
#ament_cmake：ROS2基于 CMake 封装的一套"构建系统框架"，它给普通 CMake 加了 ROS2专属的能力。
#rosidl_default_generators：消息生成器。它负责读取你的 .msg 文件，自动生成 C++ 头文件和 Python 类（即你之前笔记里的“翻译器”）。
#builtin_interfaces：关键依赖。因为你上一步在 TurtleStatus.msg 最后一行写了 builtin_interfaces/Time stamp，编译时必须找到这个内置时间类型，否则会报错。

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/TurtleStatus.msg"
  DEPENDENCIES builtin_interfaces
)
#这是整个文件的灵魂。每新增一个 .msg 都要在这里登记，上面find_package里 rosidl_default_generators包里的用法。
#"msg/TurtleStatus.msg"：告诉生成器去编译这个文件。
#DEPENDENCIES builtin_interfaces：“声明我用了这个用法，编先确保 builtin_interfaces 的接口代码已经生成完毕，再生成我的消息代码。”

ament_export_dependencies(rosidl_default_runtime)
ament_package()
#ament_export_dependencies：ament_cmake 提供的函数，导出运行时的依赖。意思是：以后别的包（比如你的海龟控制节点）依赖 turtle_interfaces 时，自动连带依赖消息运行时（rosidl_default_runtime）。
#rosidl_default_runtime 是 ament_export_dependencies() 里填的一个“运行时依赖包名，因为你的 turtle_interfaces包生成的是消息，而消息在运行时需要这些（底层库C++消息类： rosidl_runtime_cpp， Python 消息类：rosidl_runtime_py， 底层 C类型支持：rosidl_runtime_c，rosidl_default_runtim，和上面ament_export_dependencies一起使用把
#ament_package()：ROS2构建系统的标准结尾。
```


### 2.修改package.xml


#### 修改内容：


XML 第二行 <?xml-model...?>: 原文件自带的 XSD 校验头，新文件移除了它，不影响实际编译，仅减少冗余。


<description>TODO...</description> 删除了默认占位符。


<maintainer email="...">wxx</maintainer> :删除了原个人信息（新文件用了示例信息）。


<test_depend>ament_lint_auto</test_depend>,test_depend>ament_lint_common</test_depend>关键删除：移除了测试依赖。接口包核心关注消息生成，通常可暂不需要 lint 测试。


缺失的接口组与运行时​:原文件完全没有声明接口包身份和运行时依赖（这正是本次要补上的）。


### 完整的package.xml代码：
```xml
<?xml version="1.0"?>
<package format="3">
  <!-- 标准XML文件头，ROS2专用格式3 -->
  <name>turtle_interfaces</name>
  <!-- 包名，需与CMakeLists.txt中project()一致 -->
  
  <version>0.0.0</version>
  <!-- 版本号：开发中0.0.0，正式版1.0.0 -->
 
  <description>自定义话题接口：海龟状态</description>
  <!-- 包用途说明，ros2 pkg list时显示 -->
  
  <maintainer email="you@example.com">you</maintainer>
  <!-- 维护者信息，email必填 -->
  
  <license>Apache-2.0</license>
  <!-- 开源许可证 -->
  
  <member_of_group>rosidl_interface_packages</member_of_group>
  <!-- 接口包身份标识，让ros2 interface能找到.msg -->
  
  <buildtool_depend>ament_cmake</buildtool_depend>
  <!-- 构建工具。依赖类型：buildtool_depend构建工具，depend编译+运行均需 -->
  
  <depend>builtin_interfaces</depend>
  <!-- 因TurtleStatus.msg用到Time类型 -->
  
  <depend>rosidl_default_generators</depend>
  <!-- msg生成C++/Python代码的生成器 -->
  
  <depend>rosidl_default_runtime</depend>
  <!-- 运行时底层库依赖 -->
  
  <export>
    <build_type>ament_cmake</build_type>
  </export>
</package>
```
### 相关概念：


接口包三件套：name + member_of_group + rosidl_generate_interfaces


依赖三兄弟：buildtool_depend（工具）/ build_depend（库，已淘汰）/ depend（最常用）


export是结尾：告诉colcon"我是 cmake 包"


ament_package()是CMake那边的收尾，和export一一对应




### 现在大家可能会思考一个问题，CMakeLists.txt和package.xml的内容高度相似，他们是做什么工作的呢？
先给一个直觉类比（很重要）


把 ROS 包想象成一个快递包裹：


package.xml是快递面单（写清楚：谁发的、发到哪、里面有什么、需要什么特殊处理。


CMakeLists.txt是工厂流水线指令（写清楚：怎么拆包、怎么组装、用什么机器、先装什么后装什么。


面单上写了“易碎”，不代表工厂知道怎么打包，工厂知道怎么打包，不代表快递员知道这是易碎品，所以两边都要写。


package.xml 要声明依赖是给 ROS2包管理器看的，CMakeLists.txt是给编译系统看的。package.xml 说"我需要什么"，CMakeLists.txt 说"我怎么用它"。


两者看起来重复，是因为它们在两个不同层面描述同一件事——一个是给 ROS 2 包管理器看的"购物清单"，一个是给编译器看的"操作手册"。缺了任何一个，接口包都跑不起来。


## 6.之后写python发布者包文件,者直接在vscode里完成以下操作


创建内层包：
```bash
cd ~/xwg/turtle_ws/src/py_turtle_control
mkdir py_turtle_control
touch py_turtle_control/__init__.py
gedit py_turtle_control/turtle_circle.py
```

### 那为什么我们要把在包里面套了一层名字一样的文件呢？


这是 ROS 2（ament_python）与标准 Python 打包规范共同决定的“双重目录”结构。这两个同名目录的职责完全不同，代码必须放在内层。


1.外层目录：ROS 2 的“功能包根目录”

   
路径：~/turtle_ws/src/py_turtle_control/


职责：这是给 ROS 2 / colcon​ 看的。它包含整个功能包的“配置与元信息”。

	
里面放什么：package.xml（ROS依赖描述）、setup.py（Python安装配置）、resource/、LICENSE、test/ 等。

	
作用：ros2 pkg list 找的是这一层，编译也是从这一层开始。

	
2.内层目录：Python 的“实际源码包”


路径：~/turtle_ws/src/py_turtle_control/py_turtle_control/


职责：这是给 Python 解释器看的。它是真正的 Python 模块包。


里面放什么：__init__.py（必须有，标记这是Python包）、turtle_circle.py（你的实际节点代码）。


作用：当你在代码里写 import py_turtle_control 时，Python 找的就是这个目录。


假设把 turtle_circle.py 直接放在外层（和 setup.py 同级）：


packages=['py_turtle_control'] 会找不到同名子目录，编译可能报警告。


即使强行装上去，ros2 run 执行 py_turtle_control.turtle_circle:main 时，Python 会报 ModuleNotFoundError: No module named 'py_turtle_control.turtle_circle'


因为外层不被视作 Python 包。缺少 __init__.py，Python 根本不认它是包。


#### 一句话总结：外层是“ROS的壳”，内层是“Python的核”。代码放内层，才能同时满足 ROS 2 的构建规则和 Python 的导入规则。


### 又有人要问了，内外一个名字的文件夹不好，改名字可以吗？


纯技术上，Python 允许通过 package_dir 映射来“改名”。比如你把内层目录改成 src_code，可以在 setup.py 里写


但是！在 ROS 2 里千万别这么干：ROS 工具链（如资源索引、launch 文件查找）高度依赖“目录名 == 包名”的约定，强行改映射会导致 ros2 pkg list 异常或编译警告，属于自找麻烦。


### 完整的python内层包代码：
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
节点：turtle_circle（Python，本项目主力节点）

它同时干两件事：
  1)每隔 0.1 秒发一次速度指令，让海龟不停地转圈（发布者）
  2)收听海龟的真实位置，打包成自定义消息转发给C++节点（订阅者 + 发布者）
用到的 ROS2 套路：
  发布者 4 步：create_publisher → 造消息 → publish → 定时器周期重复
  订阅者 3 步：create_subscription → 写回调 → spin
"""
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist              # 速度指令（ROS2 自带）
from turtlesim.msg import Pose                   # 海龟位置（turtlesim 自带）
from turtle_interfaces.msg import TurtleStatus   # 自定义状态（我们自己写的）

class TurtleCircle(Node):
    """节点类：必须继承 Node"""

    def __init__(self):
        # 注册节点，名字叫 turtle_circle，把普通 Python 对象注册成 ROS2 节点的动作。
        # 不写这句，后面的 create_publisher、create_timer 全部失效
        # 因为 ROS2 根本不知道有你这个节点。
        super().__init__('turtle_circle')

        # ---------- 参数：运行时可以改，不用动代码 ----------
        #declare_parameter()=告诉 ROS2“我这个节点有一个参数，名字X，默认值Y，类型是Z”
        self.declare_parameter('linear_speed', 1.0)    # 前进速度
        self.declare_parameter('angular_speed', 1.0)   # 转弯速度
        self.declare_parameter('turtle_name', 'turtle1')

        #get_parameter()=告诉 ROS2“我这个节点要用一个参数，名字X，类型是Z”
        #linear_speed_ → 带尾下划线，和 ROS 2 参数名区分（命名约定）,下面用法同这个
        #get_parameter() → 从 ROS2参数系统取 Parameter 对象
        #.value → 从对象里取出真正的数字/字符串/布尔值，如self.linear_speed_ = 1.0
        self.linear_speed_ = self.get_parameter('linear_speed').value
        self.angular_speed_ = self.get_parameter('angular_speed').value
        self.turtle_name_ = self.get_parameter('turtle_name').value

        # ---------- 创建发布者：把速度指令发给海龟 ----------
        #第一个参数Twist是告诉 ROS2：我要发的是 geometry_msgs/msg/Twist 中Twist类型的消息
        #第二个参数'/turtle1/cmd_vel'是告诉ROS2：我要发给这个话题，是乌龟仿真器默认订阅这个
        #第三个参数10是告诉 ROS2：我这个发布者的队列长度是10，防止消息发得太快被丢掉
        self.cmd_pub_ = self.create_publisher(Twist, '/turtle1/cmd_vel', 10)

        # ---------- 创建发布者：把状态发给 C++ 节点 ----------
        #第一个参数TurtleStatus是告诉 ROS2：我要发的是 TurtleStatus 类型的消息
        #第二个参数'/turtle_status'是告诉ROS2：我要发给这个话题，是C++节点默认订阅这个
        #第三个参数10是告诉ROS2：我这个发布者的队列长度是10，防止消息发得太快被丢掉
        self.status_pub_ = self.create_publisher(TurtleStatus, '/turtle_status', 10)

        # ---------- 创建订阅者：收听海龟真实位置 ----------
        #create_subscription()=告诉 ROS2“我要订阅这个话题，收到消息后请调用这个回调函数”
        #第一个参数Pose是告诉ROS2：我要收的是turtlesim/msg/Pose中Pose类型的消息
        #第二个参数'/turtle1/pose'是告诉ROS2：我要收这个话题，是乌龟仿真器默认发布这个
        #第三个参数self.pose_callback是告诉ROS2：收到消息后请调用这个，下面定义了这个函数
        #第四个参数10是告诉ROS2：我这个订阅者的队列长度是10，防止消息来得太快被丢掉
        self.pose_sub_ = self.create_subscription(
            Pose, '/turtle1/pose', self.pose_callback, 10)

        # ---------- 定时器：持续下发速度指令 ----------
        #create_timer()是Node类的一个方法，返回一个Timer对象，定时器会每隔指定时间调用指定回调函数
        #告诉ROS2“请每隔 0.1 秒调用一次这个回调函数，由rclpy.spin()统一调度，到期自动调用你的回调函数”
        #create_timer() 返回一个 rclpy.timer.Timer 对象，它内部持有 C 层面的定时资源。
        #Python 的垃圾回收规则是"没人引用的对象就回收"，如果不存到 self.timer_，
        #Timer 对象引用计数为 0，被 GC 回收后 C 层面的定时器被销毁，spin() 不再调度它，回调永远不触发。
        #存到 self.xxx_ = 手动保持引用 = 告诉 Python"这个对象我还用着，别回收"。
        #self.timer_callback：下面定义了这个函数
        self.timer_ = self.create_timer(0.1, self.timer_callback)

        self.pose_ = None    # 保存最近一次收到的位置
        self.count_ = 0      # 计数器，用来减少日志刷屏
        #self.get_logger().info('消息')=用ROS2的日志系统以INFO级别输出一条带时间戳、带节点名的日志
        #替代 print()，支持级别过滤、远程查看、多节点区分。
        self.get_logger().info('海龟转圈节点已启动！')

    def timer_callback(self):
        """定时器回调：每隔 0.1 秒发一次速度指令"""
        msg = Twist()
        msg.linear.x = self.linear_speed_     # 往前走
        msg.angular.z = self.angular_speed_   # 同时不停转弯
        #发布者：把速度指令发给海龟 ，调用上面发布者指令
        self.cmd_pub_.publish(msg)
        # 一边往前一边拐弯，合起来就是画圆

    def pose_callback(self, msg):
        """订阅回调：收到海龟位置，转发成自定义消息给 C++"""
        #pose_callback 里的 msg 不是你创建的，也不是你调用的。
        #这个函数是创建订阅者时注册的回调，由ROS2在收到/turtle1/pose消息时自动调用塞给你的
        self.pose_ = msg

        status = TurtleStatus()
        status.turtle_name = self.turtle_name_
        status.x = msg.x
        status.y = msg.y
        status.theta = msg.theta
        status.linear_speed = msg.linear_velocity
        status.angular_speed = msg.angular_velocity
        #前面是把 Pose 里的数据搬到 TurtleStatus 里，下面是时间戳
        #Node.get_clock()→拿到Clock →.now()拿到当前Time→.to_msg()转成ROS2标准时间消息
        status.stamp = self.get_clock().now().to_msg()

        self.status_pub_.publish(status)

        # 海龟位置来得非常快（每秒几十次），全打印会刷屏，所以每 30 条打一次
        self.count_ += 1
        if self.count_ % 30 == 0:
            #代替print()
            self.get_logger().info(
                # f-string 格式化字符串，{变量:.2f} 表示浮点数保留两位
                f'已转发 {self.count_} 条状态：x={msg.x:.2f} y={msg.y:.2f}')
                

def main(args=None):
    """程序入口 + 收尾"""
    rclpy.init(args=args)          # 初始化 ROS2
    node = TurtleCircle()          # 创建节点
    try:
        rclpy.spin(node)           # 持续运转，等待定时器和消息
    except KeyboardInterrupt:
        pass                       # 用户按 Ctrl+C，正常退出
    finally:
        node.get_logger().info('正在停止海龟...') #代替print()
        node.cmd_pub_.publish(Twist())   # 发全零速度 = 让海龟停下来
        node.destroy_node()              # 释放资源
        rclpy.shutdown()                 # 关闭 rclpy


if __name__ == '__main__':
    main()
```
#### 概念补充：


1 spin 是让节点活着的那一行，它内部循环检查"定时器到点了吗？话题来消息了吗？"，有就调对应回调。漏了它程序启动就退出，什么都发不出去。


2 finally 里发一个全零速度​ = 停车。这非常重要：否则你 Ctrl+C 之后，海龟会按最后一个速度一直往前撞墙。


3 if __name__ == '__main__': main()
保证只有直接运行这个文件时才启动节点。ros2 run 的机制是"导入这个模块并调用它的 main()"，没有这行的话，导入时就会自动启动一个节点，出现"莫名多出一个节点"的诡异现象。


## 7.修改python发布者包文件(py_turtle_control


### 修改setup.py


1.从 find_packages(exclude=['test']) 改为 packages=[package_name] ,对于单节点、结构简单的包，直接手动指定包名列表更明确；原写法依赖 find_packages 自动搜索，新写法减少了隐式依赖。


2.新增了 'turtle_circle = py_turtle_control.turtle_circle:main',这是 ROS 2 注册可执行节点的核心。配置后，终端才能识别 ros2 run py_turtle_control turtle_circle 命令。它指向了你上一轮代码中 turtle_circle.py 里的 main 函数。原文件这里是空的，导致无法运行节点。


3.description 从默认的 'TODO: Package description' 改为实际描述 '用 Python 控制海龟转圈并转发状态'；维护者信息更新为你的名字和邮箱。完善包元数据，消除 TODO 占位符，让包信息更规范。


4.删除了原文件中的 'test': ['pytest'],当前学习阶段暂未编写单元测试，移除可保持配置精简（后续写测试时可加回）。


5.从 from setuptools import find_packages, setup 改为 from setuptools import setup，因为不再使用 find_packages()，对应导入被移除，代码更干净。


上面修改了更好，只把turtle_circle = py_turtle_control.turtle_circle:main'加上也可以运行 


### 完整的setup.py代码：
```python
from setuptools import setup
#setup() 是 Python官方打包工具 setuptools 的核心函数，ROS2的colcon build底层就是在调用它

package_name = 'py_turtle_control'
#必须和目录名、package.xml 里的 <name> 一致

#所有配置从这里开始，下面每一个参数都是 setup() 的关键字参数
setup(
    name=package_name,
    version='0.0.0',
    #name-包名（ROS 2 和 Python 都认这个），version-版本号（ROS 2 默认 0.0.0，可改）
    
    packages=[package_name],
    #	告诉 setuptools：哪些目录是 Python 包​，即内层的： 'py_turtle_control'
    
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    #data_files 是 setuptools 的参数
    #data_files=[ (安装目标路径, [源文件路径1, 源文件路径2, ...]), (安装目标路径, [源文件路径1, ...]),
    #['resource/'+package_name]='resource/py_turtle_control, 这个文件是ros2 pkg create自动生成的，没有这个标记文件就检测不到你的包。
    #['package.xml']是 ROS2包的身份证，没有 package.xml安装到share下 → ROS2运行时找不到包的元数据
    
    
    install_requires=['setuptools'],
    #作用： 声明 Python 依赖，因为 setup.py本身就是 setuptools脚本，如果用了 numpy、yaml (pip 安装的第三方库要加到列表里，内置如math不用
    
    zip_safe=True,
    #告诉 setuptools：这个包可以安全以 zip形式运行，一般默认即可
    
    maintainer='you',
    maintainer_email='you@example.com',
    description='用 Python 控制海龟转圈并转发状态',
    license='Apache-2.0',
    #元数据，分别是维护者名字，联系方式，ros2 pkg xml显示的描述，开源协议（不影响运行，但 package.xml 里也要有对应字段，两边保持一致   
     
    entry_points={
        'console_scripts': [
            # 左边是终端命令名（ros2 run 时用的命令名），右边是 内层包名+python代码名:调用的函数名
            'turtle_circle = py_turtle_control.turtle_circle:main',
        ],
    },
)
```


### 2.package.xml声明依赖（package.xml 是 ROS2包的“身份证 + 依赖清单 + 注册凭证”


```bash
gedit ~/xwg/turtle_ws/src/py_turtle_control/package.xml
```
<depend>rclpy</depend>                  <!-- import rclpy -->


#### 在rclpy后新增三个接口依赖
```xml
<depend>geometry_msgs</depend>          <!-- Twist -->
<depend>turtlesim</depend>              <!-- Pose -->
<depend>turtle_interfaces</depend>      <!-- TurtleStatus -->
```


#### 完整的package.xml代码：
```xml
<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>py_turtle_control</name>
  <version>0.0.0</version>
  <description>TODO: Package description</description>
  <maintainer email="17720980510@163.com">wxx</maintainer>
  <license>Apache-2.0</license>

  <depend>rclpy</depend>
  <depend>geometry_msgs</depend>
  <depend>turtlesim</depend>
  <depend>turtle_interfaces</depend>

  <test_depend>ament_copyright</test_depend>
  <test_depend>ament_flake8</test_depend>
  <test_depend>ament_pep257</test_depend>
  <test_depend>python3-pytest</test_depend>

  <export>
    <build_type>ament_python</build_type>
  </export>
</package>
```


## 8.我们先修改C++订阅者包文件(cpp_status_listener


### 1.修改CMakeLists.txt


新增消息包依赖,增加了 find_package(turtle_interfaces REQUIRED)(我们自定义的那个接口


移除测试与代码检查（lint）块，删除了图2中 if(BUILD_TESTING) 到 ament_lint_auto_find_test_dependencies() 的整段代码，这是 ros2 pkg create 自动生成的默认测试/版权检查逻辑


#### CMakeLists.txt文本内容如下：
```txt
cmake_minimum_required(VERSION 3.8)
#告诉 CMake至少需要 3.8 版本才能正确解析这个 CMakeLists.txt

project(cpp_status_listener)
#工程名定义，必须和 package.xml 里的 <name> 一致

#编译器警告选项，if条件检测当前编译器是不是 GCC或 Clang（Linux下基本都是）,不影响编译成功与否，但帮你抓 bug​
if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
  #Wall-打开所有常用警告（没初始化变量、未使用变量等）
  #Wextra-额外警告（空循环体、签名不匹配等）
  #Wpedantic-严格遵循 C++ 标准，拒绝非标准扩展
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)                # rclcpp/rclcpp.hpp
find_package(turtle_interfaces REQUIRED)     # 自定义消息头文件
#find_package()告诉 CMake：去系统里找这些 ROS2包，找到它们的头文件路径、库文件路径、编译选项
#REQUIRED找不到就报错
#ament_cmake ROS 2 C++ 构建系统基础,不直接 include，但必须有
#rclcppC++客户端库, 对应：#include "rclcpp/rclcpp.hpp"
#turtle_interfaces，自定义消息 TurtleStatus对应：#include "turtle_interfaces/msg/turtle_status.hpp"

add_executable(status_listener src/status_listener.cpp)
#add_executable是 CMake的内置命令，作用是"声明把哪些.cpp文件编成一个可执行程序
# 把.cpp编译成可执行文件（第一个参数就是ros2 run的命令名，后面是原代码路径）

ament_target_dependencies(status_listener rclcpp turtle_interfaces)
#ament_target_dependencies(目标名 包1 包2 ...)= 把已经 find_package找到的 ROS2包，一键把头文件+库+传递依赖，挂到我的节点上,自动帮你递归展开所有传递依赖

install(TARGETS status_listener DESTINATION lib/${PROJECT_NAME})
#TARGETS status_listener 安装上面 add_executable 生成的可执行文件
#DESTINATION lib/${PROJECT_NAME} 安装到 install/cpp_status_listener/lib/cpp_status_listener/

ament_package()
#结束声明
```


### 2.在package.xml下声明依赖


在<depend>rclcpp</depend>后面加一行：
```xml
<depend>turtle_interfaces</depend>
```


#### 完整的package.xml代码如下：
```xml
<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>cpp_status_listener</name>
  <version>0.0.0</version>
  <description>TODO: Package description</description>
  <maintainer email="17720980510@163.com">wxx</maintainer>
  <license>Apache-2.0</license>

  <buildtool_depend>ament_cmake</buildtool_depend>

  <depend>rclcpp</depend>
  <depend>turtle_interfaces</depend>

  <test_depend>ament_lint_auto</test_depend>
  <test_depend>ament_lint_common</test_depend>

  <export>
    <build_type>ament_cmake</build_type>
  </export>
</package>
```




## 9.写C++ 订阅节点（包3，只做一件事：收数据）

```bash
gedit ~/xwg/turtle_ws/src/cpp_status_listener/src/status_listener.cpp
```


### 完整的status_listener.cpp代码如下：
```cpp
// =====================================================================
// 节点：status_listener —— C++ 编写的【订阅者】
// 只干一件事：收听 /turtle_status，把收到的内容打印出来。
//
// 它收到的消息是 Python 节点发来的，而消息格式由 .msg 文件定义，
// 所以 Python 和 C++ 虽然语言不同，却能无缝对话 —— 这就是 ROS2 的魅力。
//
// C++ 订阅者套路（4 步）：
//   第1步 继承 rclcpp::Node
//   第2步 create_subscription<消息类型>("话题名", 队列长度, 回调)
//   第3步 写回调函数
//   第4步 main 里 rclcpp::spin(节点)
// =====================================================================

#include <memory>                 // std::make_shared 智能指针
#include <string>                 // std::string
#include "rclcpp/rclcpp.hpp"      // ROS2 的 C++ 库，等于 Python 里的 rclpy
                                  // msg/TurtleStatus.msg → "包名/msg/turtle_status.hpp"
#include "turtle_interfaces/msg/turtle_status.hpp"

using std::placeholders::_1;   
//C++ 标准库早就定义了 std::placeholders::_1
//后面你写 _1，编译器自动替换成全名，_1 就是 std::bind 的"占位坑"，标记"调用者传的第一个参数放这里"。
//它不存数据、不运行、不阻塞，纯粹是绑定阶段的标记。消息到了，ROS2往_1那个坑里一塞，你的回调就拿到了msg。

// 【第1步】继承 rclcpp::Node
class StatusListener : public rclcpp::Node
{
public:
  StatusListener()
  : Node("status_listener")       // 节点名，不能和 Python 节点重名
  {
    // 参数：每收到几条打印一次（防止刷屏）
    this->declare_parameter<int>("print_every", 30);
    print_every_ = this->get_parameter("print_every").as_int();
    // print_every_在private里定义了，默认值是30，用户可以在启动节点时通过参数覆盖它。
    //as_int()是ROS2里rclcpp::Parameter类的一个成员函数，专门用来把参数值转成int类型

    // 【第2步】创建订阅者
    // 注意：C++ 的成员函数不能直接当回调，必须用 std::bind 包一层：
    //   std::bind(&类名::函数名, this, _1)
    //   _1 是占位符，表示"将来收到的那条消息"
    subscription_ = this->create_subscription<turtle_interfaces::msg::TurtleStatus>(
      "/turtle_status", 10,
      std::bind(&StatusListener::status_callback, this, _1));
      //python版订阅：self.subscription = self.create_subscription(
      //  TurtleStatus,turtle_status',self.status_callback,10 )

    RCLCPP_INFO(this->get_logger(), "C++ 订阅者已启动，正在收听 /turtle_status ...");
  }
  //这行是 ROS 2 的日志输出（打日志），相当于你 Python 里的 self.get_logger().info(...)

private:
  // 【第3步】回调函数：每收到一条消息，ROS2 自动调用一次
  // ::SharedPtr 是 ROS2 推荐写法（智能指针，自动管内存，不用手动 delete）
  //msg和python里pose接口那说过的一样，这个msg是接收到的消息，不是自己创建的
  void status_callback(const turtle_interfaces::msg::TurtleStatus::SharedPtr msg)
  {
    count_++;

    // 每 print_every_ 条打印一次，避免刷屏
    if (count_ % print_every_ != 0) {
      return;
    }

    // %s 对应字符串，%.2f 对应保留两位小数的浮点数
    // C++ 的 std::string 传给 %s 必须加 .c_str()
    // %d 对应整数，%09u 表示不足 9 位前面补 0（纳秒是 9 位数）
    RCLCPP_INFO(this->get_logger(),
      "[C++收到 #%d] %s | 时间 %d.%09u | 位置 x=%.2f y=%.2f 朝向=%.2f | 速度 前=%.2f 转=%.2f",
      count_, msg->turtle_name.c_str(),
      msg->stamp.sec, msg->stamp.nanosec,
      msg->x, msg->y, msg->theta,
      msg->linear_speed, msg->angular_speed);
  }
  // ===== 成员变量 =====
  rclcpp::Subscription<turtle_interfaces::msg::TurtleStatus>::SharedPtr subscription_;
  //rclcpp::Subscription是ROS2里订阅者的类模板，<>里是消息类型
  //turtle_interfaces::msg::TurtleStatus=turtle_interfaces包的msg子空间里的TurtleStatus类
  //SharedPtr 是智能指针，自动管内存，不用手动 delete。

  int count_ = 0;          // 收到多少条
  int print_every_ = 30;   // 每几条打印一次
};

// 【第4步】main 函数
int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);                          // 1) 初始化 ROS2
  auto node = std::make_shared<StatusListener>();    // 2) 创建节点
  rclcpp::spin(node);                                // 3) 持续运转，等待消息
  rclcpp::shutdown();                                // 4) Ctrl+C 后收尾
  return 0;
}
```
### C++ 代码里几个必须讲清的点


1.头文件名怎么来的？


msg/TurtleStatus.msg → #include "包名/msg/turtle_status.hpp"，文件名全小写 + 下划线 + .hpp。这是死规则，TurtleStatus 会变成 turtle_status。


2.为什么回调要 std::bind？


Python 里 self.pose_callback 直接传就行；C++ 里成员函数隐含一个 this 参数，不能直接当函数指针，必须用 std::bind(&类::函数, this, _1) 把它"绑成"普通函数。_1 表示将来收到的那条消息。


3.为什么用 ::SharedPtr？


ROS2 推荐用智能指针接收消息，自动管理内存，不用 delete。写成 const XXX::SharedPtr msg 是标准姿势。


4..c_str() 为什么必须有？


RCLCPP_INFO 底层是 C 语言的 printf，%s 只认 C 风格字符串。std::string 必须 .c_str() 转换，否则打印出乱码。


5.rclcpp::spin(node) 的作用


和 Python 的 rclpy.spin(node) 完全一样——让节点活着并持续响应。没有它，程序 main 跑完就退出，一条都收不到。




## 10.编译项目
```bash
cd ~/xwg/turtle_ws
source /opt/ros/humble/setup.bash
colcon build
```
看到 Summary: 3 packages finished 就成功了!


```bash
source ~/xwg/turtle_ws/install/setup.bash
ros2 interface show turtle_interfaces/msg/TurtleStatus
```
能看到7个字段，说明自定义接口这一步你已经掌握了。



## 11.运行（三个终端）


### 终端 1 —— 启动海龟模拟器：
```bash
cd ~/xwg/turtle_ws
source /opt/ros/humble/setup.bash
ros2 run turtlesim turtlesim_node
```


### 终端 2 —— 启动 Python 节点：
```bash
source /opt/ros/humble/setup.bash
source ~/xwg/turtle_ws/install/setup.bash
ros2 run py_turtle_control turtle_circle
```
这时海龟开始转圈，终端每 30 条打一次"已转发状态"。


### 终端 3 —— 启动 C++ 订阅者：
```bash
source /opt/ros/humble/setup.bash
source ~/xwg/turtle_ws/install/setup.bash
ros2 run cpp_status_listener status_listener
```
会看到 [C++收到 #30] turtle1 | 位置 x=... y=...。 


### Python发、C++收，跨语言通信这就跑通了。


### 改参数玩一玩（不用改代码）


画大一点的圆：减小转弯速度
```bash
ros2 run py_turtle_control turtle_circle --ros-args -p angular_speed:=0.3
```


画小一点的圆：加大转弯速度
```bash
ros2 run py_turtle_control turtle_circle --ros-args -p angular_speed:=2.5
```


让它跑快点
```bash
ros2 run py_turtle_control turtle_circle --ros-args -p linear_speed:=3.0
```


C++ 那边改成每 5 条打印一次
```bash
ros2 run cpp_status_listener status_listener --ros-args -p print_every:=5
```


## 以上就是整个项目的全过程
