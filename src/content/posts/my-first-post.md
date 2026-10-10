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
![ros2xwg49行](/public/image/xwg_node/p2-1.png)


滑到第一行Type会显示：Type: geometry_msgs/msg/Twist （Twist是我们写代码要import的类型


##### 让我们看看它字段长什么样： 
```bash
ros2 interface show geometry_msgs/msg/Twist
```


![ros2xwg62行](/public/image/xwg_node/p2-2.png)


Vector3  linear float64 x float64 y float64 z （xyz方向线速度


Vector3  angular float64 x float64 y float64 z （xyz方向加速度


#### 2.我们再看pose（使用pose,海龟会报出自己真实位置


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





想强调就 **加粗**，想写代码就 `这样`。

```bash
gedit ~/xwg/turtle_ws/src/turtle_interfaces/msg/TurtleStatus.msg
```
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
