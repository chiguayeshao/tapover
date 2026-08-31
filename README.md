# Tapover

在 [GMGN](https://gmgn.ai) 代币页右侧买卖卡下方确认，由已打开的 [FOMO](https://fomo.family) 标签用**它自己的买卖卡**成交。

非官方。不是 GMGN 或 FOMO 出品。

FOMO ToS 禁止用软件自动成交。Tapover 是 DOM 转发，号可能被风控。

## 做什么

1. 进 GMGN 币页时，已打开的 FOMO 标签后台跳到同一个币（不抢 profile / 设置 / 导出密钥页）
2. 点确认后，在那张 FOMO 买卖卡上填金额并点 FOMO 自己的按钮

Robinhood 上的币走 FOMO 的 Robinhood 卡（界面是 USDG）。Tapover 不自己选 Solana USDC，也不调 `fast-fill`。

## 安装

1. `git clone https://github.com/chiguayeshao/tapover.git`
2. Chrome 打开 `chrome://extensions`
3. 开发者模式 → 加载已解压 → 选中本仓库目录
4. 改过代码后刷新扩展，然后硬刷新 **GMGN 代币页** 和 **FOMO 标签**

本地若仍从旧目录 `gmgn-fomo-bridge` 加载，刷新扩展即可；卡片品牌会变成 Tapover。

## 用法

1. 钉住一个已登录的 fomo.family 标签（不要只用资料页）
2. 打开 GMGN 代币页
3. 右侧出现 Tapover 卡片
4. 填金额 → 确认买入 / 确认卖出

## License

[MIT](LICENSE)。**这一版永远免费、可 fork。**

版权人可以在后续版本加入收费功能、闭源模块或商业发行。已经发布在本仓库的代码不会改成专有许可；别人 fork 走 0.3.x，仍然按 MIT 使用。

PR 的再许可规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。
