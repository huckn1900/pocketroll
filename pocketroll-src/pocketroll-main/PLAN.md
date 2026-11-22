# Film Filter App — 总计划

灵感参照：ROLLIE'S（$6.99 买断，camera+film 组合实时 viewfinder，4.8★）。我们做同类但差异化：界面模仿 point-and-shoot 相机**背面**，正确的 roll 管理，10 相机 × 15 胶片组合。

## 阶段
1. ✅ 研究：10 相机 + 15 胶片 + 参考 app + 上架/法务（见 docs/research.md）
2. ✅ 素材库：`assets/cameras.json`、`assets/films.json`（含 app 侧模拟参数）
3. **UI 原型**（进行中→下一步）：单文件 HTML。界面 = 傻瓜相机背面：
   - 顶部「viewfinder 窗」= 实时相机画面（getUserMedia）
   - 背面质感：cream/beige 塑料机身、噪点纹理、印刷感小字标签、红色 dot 点缀、film ISO dial、shot counter 0/36、OPEN 背盖动画
   - 选相机 = 「换机身」；选胶片 = 「装卷」；拍满 36 张 → rewind 动画
4. **滤镜引擎**：canvas 管线 per combo——
   - camera 层：色偏/锐度/vignette/quirk（LC-A light leaks、AF35M flash 感…）
   - film 层：tone curve（contrast/black_lift/white_point）→ 分色 tint（highlights/shadows）→ saturation → grain（噪声纹理叠加）→ halation（高光 bloom 带色）→ vignette/fade
   - 参数全部来自 assets/films.json + cameras.json
5. **打包上架**：Capacitor（复用 web 引擎）→ Android APK（本机可构建）；iOS 走 Mac/Xcode Cloud。
   - 成本：Google Play $25 一次性 + Apple $99/年 ≈ 第一年 $124
   - 定价策略：买断（学 ROLLIE'S $6.99）或免费+premium 解锁全部 film——先免费+6 胶片免费做钩子
6. **法务执行**：app 名自创（候选：Grainy / RollCall / PocketRoll / FilmGate——避免商标词）；不用品牌 logo；滤镜命名双轨（描述名 + 自创名 fallback）；页脚 disclaimer；若被 Play/Apple 打回 → 切自创名。
7. 验证：本机浏览器跑原型 + 真实图片测试 15 滤镜；Android APK 构建可延后到用户有测试机时。

## 差异化点（对照 ROLLIE'S 差评）
- roll 状态跟胶片走不跟相机走；换相机不换卷
- 正确的张数（35mm=36）；rewind 仪式感
- 相机背面 UI（ROLLIE'S 是商店货架风）→ 我们的记忆点是「翻过来看背面」
