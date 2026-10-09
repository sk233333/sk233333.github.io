---
title: Markdown 语法示例
published: 2026-10-09
description: 标题、字号、代码块、提示框等常用写法速查，写完删掉本文件即可
image: ""
tags: [示例, Markdown]
category: 教程
draft: false
---

## 一、标题（# 号个数决定级别）

# 一级标题 H1

## 二级标题 H2

### 三级标题 H3

#### 四级标题 H4

##### 五级标题 H5

###### 六级标题 H6

> 提示：H1 一般不用（文章标题已经自动渲染成 H1），正文从 `##` 开始写，左侧会自动生成目录。

---

## 二、正文字号（Markdown 本身没有字号语法）

标准 Markdown **没有**调整字号的语法，需要用 HTML 标签。下面三种都能用，**推荐第一种**，最稳：

<span style="font-size:0.75rem">这是超小字（12px）</span>

<span style="font-size:0.875rem">这是小字（14px），适合写注释、补充说明</span>

<span style="font-size:1rem">这是正常字号（16px）</span>

<span style="font-size:1.25rem">这是大字（20px）</span>

<span style="font-size:1.5rem">这是超大字（24px）</span>

整段改字号：

<div style="font-size:0.875rem;color:#888">

这一整段都是小字，适合放脚注、参考资料、版权说明这一类不想抢视线的内容。

</div>

改颜色：

<span style="color:#e55039">红色文字</span>
<span style="color:#60a5fa">蓝色文字</span>
<span style="background:#fef08a">黄色高亮</span>

居中：

<p style="text-align:center">这段文字居中显示</p>

---

## 三、强调

**这是加粗**

*这是斜体*（也可以用 _斜体_）

***这是又粗又斜***

~~这是删除线~~

这是 `行内代码`

上标：X<sup>2</sup>　下标：H<sub>2</sub>O

---

## 四、代码块（自动带复制按钮）

只要用三个反引号 + 语言名，Fuwari 会自动渲染出**语法高亮 + 行号 + 右上角复制按钮**，不需要额外配置。

```javascript
function hello() {
  console.log("鼠标移到代码块右上角，就会出现复制按钮");
}
hello();
```

带文件名标题（在语言名后面加 `title="xxx"`）：

```python title="main.py"
def add(a, b):
    return a + b

print(add(1, 2))
```

高亮指定行（大括号里写行号）：

```js {2,4}
const a = 1;
const b = 2; // 这一行会被高亮
const c = 3;
const d = 4; // 这一行也会被高亮
```

高亮连续行 `{1-3}`、标记新增/删除行：

```js {1,3-4} ins={3} del={4}
const keep = 1;
const alsoKeep = 2;
const added = 3;
const removed = 4;
```

长代码折叠（`collapse` 后面写要折叠的行范围）：

js title="长代码折叠示例" collapse={2-20}
```
const visible = "这段一直显示";
const long1 = 1;
const long2 = 2;
const long3 = 3;
const long4 = 4;
const long5 = 5;
const long6 = 6;
```

常用语言标识：`js` `ts` `python` `java` `c` `cpp` `go` `rust` `bash` `json` `yaml` `html` `css` `sql` `md`

不写语言名就是纯文本块：

```
这是纯文本，没有高亮，但依然有复制按钮
```

---

## 五、提示框（Admonition）

> [!NOTE]
> 蓝色提示：补充说明信息。

> [!TIP]
> 绿色建议：小技巧、推荐做法。

> [!IMPORTANT]
> 紫色重要：关键信息。

> [!WARNING]
> 黄色警告：容易踩的坑。

> [!CAUTION]
> 红色危险：会导致错误的操作。

---

## 六、列表

无序列表：

- 第一项
- 第二项
  - 嵌套子项（缩进两个空格）
  - 另一个子项
- 第三项

有序列表：

1. 第一步
2. 第二步
3. 第三步

任务列表：

- [x] 已完成的事
- [ ] 还没做的事

---

## 七、引用

> 这是引用块。
>
> 引用可以写多行，也可以嵌套：
> > 这是嵌套引用。

---

## 八、链接和图片

行内链接：[访问 GitHub](https://github.com)

直接显示网址：<https://github.com>

带提示的链接：[GitHub](https://github.com "鼠标悬停显示这段文字")

图片：

![图片说明](https://picsum.photos/800/400)

同目录下的图片（相对路径）：

![本地图片](./cover.jpg)

---

## 九、表格

| 语法 | 写法 | 用途 |
| :--- | :---: | ---: |
| 左对齐 | `:---` | 默认 |
| 居中 | `:---:` | 数据 |
| 右对齐 | `---:` | 数字 |

| 字段 | 必填 | 说明 |
| --- | :---: | --- |
| title | 是 | 文章标题 |
| image | 否 | 封面图 |
| draft | 否 | 是否草稿 |

---

## 十、分割线

三个或更多 `-`、`*`、`_` 独占一行即成分割线。

---

## 十一、数学公式

行内公式：$E = mc^2$

独占一行：

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

---

## 十二、折叠详情

<details>
<summary>点我展开看隐藏内容</summary>

这里是折叠起来的内容，适合放长答案、剧透、详细步骤。

</details>

---

## 十三、快捷键按键样式

按 <kbd>Ctrl</kbd> + <kbd>C</kbd> 复制，按 <kbd>Ctrl</kbd> + <kbd>V</kbd> 粘贴。

---

> 看完记得把本文件删掉：仓库里进入 src/content/posts/ → 点开本文件 → 右上角垃圾桶 → Commit changes。
