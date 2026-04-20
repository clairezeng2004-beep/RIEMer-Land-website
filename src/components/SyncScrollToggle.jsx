/**
 * SyncScrollToggle —— Markdown 双栏编辑器上方的「同步滚动」开关按钮。
 *
 * 统一复用到所有 Markdown 编辑入口（MemberSharingCreate /
 * ProcessTemplateCreate / ProcessTemplateDetail 编辑态…），
 * 保证：
 *   1. 按钮样式、文案、title 在所有页面完全一致
 *   2. 交互触发条件明确：点一下切换 on/off，没有"隐式自动开启"
 *   3. 新增编辑入口时无需再重复写 JSX，直接引入本组件
 *
 * 为什么单独做一个 13 行的组件：
 *   - 防止不同页面复制粘贴时各自微调文案，长期漂移
 *   - 集中在这里管理 a11y（aria-pressed）、title、class
 *
 * 样式来自 src/pages/internal/MemberSharingCreate.css 里
 * `.msc-md-split__sync-btn / --on / __sync-dot`，目前这份样式表
 * 已被三个页面各自 import，所以本组件直接沿用 class 不需要再注入样式。
 */
function SyncScrollToggle({ on, onToggle, className = '' }) {
  return (
    <button
      type="button"
      className={`msc-md-split__sync-btn ${on ? 'msc-md-split__sync-btn--on' : ''} ${className}`.trim()}
      onClick={onToggle}
      aria-pressed={on}
      title={
        on
          ? '已开启同步滚动：编辑与预览一起滚动。点击关闭后可分别滚动。'
          : '未开启同步滚动：编辑与预览可分别滚动。点击开启同步。'
      }
    >
      <span className="msc-md-split__sync-dot" />
      同步滚动{on ? '（已开启）' : '（已关闭）'}
    </button>
  );
}

export default SyncScrollToggle;
