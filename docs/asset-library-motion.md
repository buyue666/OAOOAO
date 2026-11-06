# 创作资产动效

以 Motion Prompt 的界面元素为参考，用原生 CSS 适配已有 React/Radix 组件。只在操作发生时播放，不增加动画依赖或常驻动画循环。主页面保留原有空间、排版与颜色。

| 元素 | 使用位置 | 保留的节奏 | 适配 |
| --- | --- | --- | --- |
| [#049 Modal dialog](https://showheyohtaki.github.io/motion-prompt/#049) | 上传、编辑、预览和删除弹窗 | 打开 320ms，关闭 280ms；缩放 .9→1，透明度 0→1；遮罩 42% | 原生 CSS starting-style 与可中断过渡；表面、文字和遮罩映射 OAO 主题；退出期间保留原内容 |
| [#052 Accordion](https://showheyohtaki.github.io/motion-prompt/#052) | 批量选择工具栏 | 展开 350ms，收起 320ms；高度与透明度同步 | 内容高度代替演示中的固定 58px 增量；按钮通过 expanded/controls 关联工具栏 |
| [#055 Popover](https://showheyohtaki.github.io/motion-prompt/#055) | 卡片更多操作菜单 | 打开 280ms，关闭 200ms；水平 6px 淡入淡出 | 使用现有 Radix 锚定、避让及键盘行为；菜单颜色和边框沿用主题，无演示鼠标 |
| [#060 Segmented control](https://showheyohtaki.github.io/motion-prompt/#060) | 网格/列表切换 | 250ms 滑动，easeInOutCubic | 改为两个 44px 控件，底色使用 muted，选中保持前景色；不重复播放列表入场 |
| [#072 Empty state](https://showheyohtaki.github.io/motion-prompt/#072) | 无素材/无匹配/暂不可用状态 | 350ms linear，8px 上移和透明度 0→1 | 保留现有提示与操作，只播放出现阶段并停留；不模拟删除或新增操作 |

## 一致性和边界

- UI kit 的强调色映射 `--studio-accent`，白色面板映射 `--card`/`--popover`，边线映射 `--border`，文字映射 `--foreground`/`--muted-foreground`。
- easeOutCubic 精确转换为 `cubic-bezier(.333333,1,.666667,1)`；easeInOutCubic 近似为 `cubic-bezier(.65,0,.35,1)`。不添加回弹。
- 关闭中的工具栏和弹窗设为 inert/aria-hidden；关闭预览会立即暂停媒体；快速重新打开会撤销旧的卸载计时器。独立弹窗标题 ID 避免退出与新弹窗重叠时发生重复。
- `prefers-reduced-motion: reduce` 下取消本次添加的动画与过渡，弹窗不等待退出时长。
- 未支持 CSS `@starting-style` 的浏览器可直接显示弹窗打开终态，关闭与业务交互继续可用。
- 相关动画 CSS 和组件中保留 Motion Prompt 的 MIT 署名。浏览器验收使用隔离素材样本，不写入或删除生产素材。
