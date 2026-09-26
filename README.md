# Tapover

作者：[吉霸猫 @0x_JBCat](https://x.com/0x_JBCat)

[GMGN](https://gmgn.ai/r/TM05q4qC?chain=robinhood) 战壕扫链，[FOMO](https://fomo.family/r/0x_JBCat) 交易发布观点。

注意：这不是 GMGN 或 FOMO 的官方产品。FOMO 用户条款禁止用软件自动成交，使用本扩展有被风控或封号的风险。

## 安装

适用于 Chrome、Edge、Brave。

1. 下载本仓库：右上角 **Code → Download ZIP**，解压；或执行 `git clone https://github.com/chiguayeshao/tapover.git`
2. 浏览器打开 `chrome://extensions`，打开右上角 **开发者模式**
3. 点 **加载已解压的扩展程序**，选中文件夹（里面要能直接看到 `manifest.json`）

工具栏出现 Tapover 图标即表示装好了。以后更新：重新下载或 `git pull` 之后，在扩展页点刷新，再分别刷新 GMGN 代币页和 FOMO 标签。

## 使用

先打开 [fomo.family](https://fomo.family/r/0x_JBCat) 并登录。

再到 [GMGN](https://gmgn.ai/r/TM05q4qC?chain=robinhood) 打开代币页。原有买卖卡下方会出现 Tapover：选买入或卖出，填金额或点预设，然后确认。FOMO 那一侧会完成成交。

Robinhood 上的币走 FOMO 的 Robinhood 交易卡，界面计价是 USDG。卖出要求 FOMO 上已经有这个币的仓位，没有仓位时卖出按钮是灰的。

卡片右上角齿轮可以改四档买入金额和四档卖出比例。旁边的箭头可以把面板收成一条，再点展开。收起状态会记住。

## 作者

[吉霸猫 @0x_JBCat](https://x.com/0x_JBCat)

扫链：[FOMO](https://fomo.family/r/0x_JBCat)
交易：[GMGN](https://gmgn.ai/r/TM05q4qC?chain=robinhood)

## 更新日志

### 0.3.2 — 2026-09-26

交易面板右上角增加隐藏按钮。点一下收成一条 Tapover 细条，再点展开。切币、刷新后仍保持上次的收起状态。

### 0.3.1 — 2026-09-02

GMGN 上点 token 时，FOMO 不再整页刷新。跟你在 FOMO 里点 token 看 K 线一样，只局部换图表和买卖卡。

更新后：`chrome://extensions` 刷新 Tapover，再分别刷新 GMGN 代币页和 FOMO 标签。旧页面里的脚本不会自动换成新逻辑。

### 0.3.0

首个 MIT 公开发布。

## 许可

当前版本以 [MIT](LICENSE) 发布，可免费使用、修改和再分发。
