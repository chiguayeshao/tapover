# Tapover

在 [GMGN](https://gmgn.ai/r/TM05q4qC?chain=robinhood) 看币，在 [FOMO](https://fomo.family/r/0x_JBCat) 成交。Tapover 把这两步接起来：你打开某个代币页时，已经登录的 FOMO 标签会跟到同一个币；你在 GMGN 右侧的 Tapover 卡片里点确认，FOMO 自己的买卖卡会填好金额并按下确认。

这不是 GMGN 或 FOMO 的官方产品。FOMO 用户条款禁止用软件自动成交，使用本扩展有被风控或封号的可能。

## 安装

适用于 Chrome、Edge、Brave。

1. 下载本仓库：右上角 **Code → Download ZIP**，解压；或执行 `git clone https://github.com/chiguayeshao/tapover.git`
2. 浏览器打开 `chrome://extensions`，打开右上角 **开发者模式**
3. 点 **加载已解压的扩展程序**，选中文件夹（里面要能直接看到 `manifest.json`）

工具栏出现 Tapover 图标即表示装好了。以后更新：重新下载或 `git pull` 之后，在扩展页点刷新，再分别刷新 GMGN 代币页和 FOMO 标签。

## 使用

先打开 [fomo.family](https://fomo.family/r/0x_JBCat) 并登录，把这个标签钉在窗口里。不要只用个人主页或设置页，需要一张能买卖的代币页。

再到 [GMGN](https://gmgn.ai/r/TM05q4qC?chain=robinhood) 打开代币页。原有买卖卡下方会出现 Tapover：选买入或卖出，填金额或点预设，然后确认。FOMO 那一侧会完成成交。

Robinhood 上的币走 FOMO 的 Robinhood 交易卡，界面计价是 USDG。卖出要求 FOMO 上已经有这个币的仓位，没有仓位时卖出按钮是灰的。

卡片右上角齿轮可以改四档买入金额和四档卖出比例。

## 许可

当前版本以 [MIT](LICENSE) 发布，可免费使用、修改和再分发。
