# RIEMer Land 🌿

> 在交流中成长，一起找到更好的自己

**RIEMer Land** 是由西南财经大学经济与管理研究院（RIEM）学生自主发起的互助平台，旨在促进 RIEM 校友和在校学子的经验交流与共享。在这里，你将获得 RIEMers 真实多元的心得，在朋辈的生动分享中看到属于自己的那一份可能性。

## ✨ 我们的使命

- 促进 RIEM 校友与在校学子的经验交流
- 提供真实多元的学习与职业发展心得
- 搭建朋辈互助与信息共享平台
- 帮助每一位 RIEMer 找到属于自己的可能性

## 📊 平台数据

| 活动讲座 | 文章分享 | 公众号累计阅读 | 成立时间 |
| :------: | :------: | :------: | :------: |
|   10+    |   30+    | 20,000+  |   2024   |

## 🌱 发展历程

- **2024** — 平台创立：RIEMer Land 由西南财经大学 RIEM 学生自主发起
- **2025** — 「听 RIEMer 说」访谈系列上线，邀请校友分享就业、考研、留学等多元经验
- **2025** — RIEMer's Space 分享会启动，覆盖数模备赛、快消行业、职业选择等主题
- **2025** — 课程测评与专业方向指南发布，帮助学弟学妹选课参考
- **2025** — 主理团队招新，壮大平台运营力量

## 🏗 项目简介

本仓库是 RIEMer Land 的官方网站，包含公开展示页面和内部成员管理空间。

### 公开页面

- **首页** — 组织介绍、核心使命与数据展示
- **分享回顾** — 文章列表与详情（「听 RIEMer 说」系列、课程测评、经验分享等）
- **关于我们** — 组织发展时间线

### 内部空间（登录后访问）

- **首页仪表盘** — 快速统计、功能模块入口、最近消息
- **消息通知** — 团队通知、系统提醒和重要消息
- **文档管理** — 上传、查看和管理团队内部文档资料
- **事项追踪** — 待办事项、任务分配与进度跟踪
- **活动相册** — 按主题分组的活动照片管理
- **用户管理** — 成员账号与角色管理（管理员）
- **内容管理** — 公开页面内容编辑（管理员）

## 🛠 技术栈

- **框架**：[React](https://react.dev/) 19 + [Vite](https://vite.dev/) 8
- **路由**：[React Router](https://reactrouter.com/) v6
- **图标**：[Lucide React](https://lucide.dev/)
- **工具**：[pinyin-pro](https://github.com/zh-lx/pinyin-pro)（拼音处理）

## 🚀 本地开发

```bash
# 克隆仓库
git clone git@github.com:clairezeng2004-beep/RIEMer-Land-website.git
cd RIEMer-Land-website

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

## 📁 项目结构

```
src/
├── components/          # 公共组件（Navbar、Footer、InternalLayout、InternalSidebar）
├── contexts/            # React Context（Auth、SiteContent、Notification）
├── data/                # 数据文件（组织信息、文章、活动、文档等）
├── pages/
│   ├── public/          # 公开页面（Home、Timeline、Articles、ArticleDetail）
│   └── internal/        # 内部页面（InternalHome、Documents、Tasks、Gallery 等）
├── App.jsx              # 根组件与路由配置
└── main.jsx             # 应用入口
```

## 📬 联系我们

- 📧 邮箱：riemerland@swufe.edu.cn
- 📍 地址：西南财经大学 经济与管理研究院

---

*Made with ❤️ by RIEMer Land 主理团队*
