# 研究记录（Round 1）

## 相机（10 款 point-and-shoot 35mm，classic + fun）
入选逻辑：4 款复古好玩（Trip 35 / Instamatic / AF35M / L35AF）+ 5 款传奇（T4 / T2 / μ-II / GR1v / TC-01）+ 1 款 cult 玩具（Lomo LC-A）。
来源：
- [Field Mag: 11 Best Point and Shoot Film Cameras (2026-07)](https://www.fieldmag.com/articles/best-point-and-shoot-film-cameras) — Contax T2 (1990, Zeiss Sonnar 38mm f/2.8, ~$1000 eBay)、GR1v (2001, 28mm f/3.5, ~$800)、Yashica T4、Minolta TC-01、Nikon 35Ti、Konica Big Mini F、Olympus Stylus MJU II、Nikon L35AF
- [Shoot It With Film: 12 Best Point and Shoot (2025)](https://shootitwithfilm.com/5-best-point-and-shoot-film-cameras/) — Contax T2 为榜首共识
- [Amateur Photographer: Best fixed lens 35mm](https://amateurphotographer.com/buying-advice/best-fixed-lens-35mm-film-cameras/) — Olympus Trip 35「one of the world's most successful cameras」，£40–70/$70–80
- [Urth Magazine](https://magazine.urth.co/articles/favourite-35mm-travel-cameras) — Yashica T4 Zeiss 35mm f/3.5 weatherproof
- [Casual Photophile](https://casualphotophile.com/2015-04-05/best-point-and-shoot-film-cameras-30/) — Canon AF35M / Nikon L35AF budget tier
- [Lomography: Diana charm](https://www.lomography.com/magazine/327536-the-undeniable-charm-of-the-diana-cameras) / [Canny Cameras 35mm alternatives](https://austerityphoto.co.uk/want-a-diana-experience-but-cant-afford-120-then-here-10-35mm-alternatives/) — lo-fi 35mm 玩具（Diana Mini、Lomo LX）；选 LC-A 因其更经典（1983，32mm f/2.8，Lomography 运动源头）
备注：Instamatic 用 126 cartridge（非 135），作为「honorary」条目入库并标注格式——它是 point-and-shoot 文化的原型。

## 胶片（15 款）
覆盖：黑白 4（Tri-X / HP5 / Delta / Kentmere）、彩色负片 6（Portra 160/400 / Gold / Ektar / ColorPlus / Vision3 500T / Cinestill 800T — 7 款含电影负片）、反转片 5（Velvia / Provia / E100 / Kodachrome）、滑片共 5。
来源：
- [Popular Photography: 8 classic films](https://www.popphoto.com/gear-reviews/classic-film-you-should-try/) — Tri-X 400（1954 起，grainy/contrasty = 20世纪下半叶美国纪实的象征，可 push 800/1600）、HP5 Plus 等
- [Field Mag: Best 35mm Film](https://www.fieldmag.com/articles/best-35mm-film) — Portra 400「most beloved」、Wide latitude/ISO/美学三要素框架、Cinestill/Superia
- [Digital Camera World](https://www.digitalcameraworld.com/buying-guides/best-film) — Portra 400 声誉佐证
- [Leica: Film Stock Overview](https://leica-camera.com/en-US/photography/film-stock-overview) — Portra family 定位
- [Film Photography: Choosing Film](https://www.filmphotography.com/learn/choosing-film-stock) — 每 stock 有 own speed/grain/contrast/color
- Shutterbug 10 favorites（被 CAPTCHA 挡住，未采正文；Tri-X/Velvia/Kodachrome 地位另由 popphoto/行业共识佐证）
滤镜参数（contrast/tint/grain/halation/fade）= 基于各胶片文献描述的**近似值**，开发中需对照真实样片调参。

## 参考 app：ROLLIE'S
- [App Store 页](https://apps.apple.com/us/app/rollies-35mm-film-camera/id6805318319)：$6.99 买断、iPhone only、107.9MB、4.8★(75 评分)、Photo & Video paid chart #3、开发者 마야크루（韩国）
- 理念：「A little camera shop in your pocket」— body+lens+film 组合各有 look，viewfinder 实时预览；36-shot roll；无订阅无内购；照片只在本地除非上传 PHOTO PARADE
- 用户差评焦点：roll 管理（换相机重置 roll、120 应 12 张、6x9 应 8 张）→ 我们的差异化机会：正确的 roll 计数 + 换相机不换 roll

## 上架路线
- Google Play：$25 一次性注册（[Play Console Get started](https://support.google.com/googleplay/android-developer/answer/6112435)）；IP 政策：不允许侵犯他人商标/版权，若有书面授权可提前联系 Play team（[IP policy](https://support.google.com/googleplay/android-developer/answer/9888072)）；Impersonation 政策禁止模仿他人 app
- Apple：Developer Program $99/年（[enroll](https://developer.apple.com/programs/enroll/)）；Guideline 4.1 禁止 copycat/impersonation（[4.1 页](https://developer.apple.com/help/app-review/guideline-reference/4-1-prevent-copycat-rejection/)）；2.3 Accurate Metadata 禁止误导性描述
- 第一年总成本 ≈ $124（[newly.app 测算](https://newly.app/guides/cost-to-publish-an-app)）
- 技术路线（本机只有 Windows）：先做 web 原型（HTML/canvas 滤镜引擎）→ Capacitor 打包 Android APK（Windows 可建）；iOS 需 Mac/Xcode Cloud 或云端 Mac 构建。备选 Flutter（需重实现滤镜层）。

## 法务（trademark/copyright）
- **胶片/相机的「外观 look」没有 copyright**：风格/方法不受版权保护，滤镜本身是我们的原创实现 → 安全
- **品牌/型号名是商标**：Kodak, Tri-X, Portra, Ektachrome, Kodachrome, Contax, Zeiss, Olympus, Ricoh, Minolta, Lomo, Yashica, Nikon, Fujifilm, Velvia, Provia, Ilford, HP5, Cinestill…
- 安全用法（nominative/descriptive fair use 三条件，[mclaw.io toolkit](https://mclaw.io/blog/trademark-fair-use-toolkit--nominative-use-guidelines-comparative-advertising-clearance-and-defense-briefing)、[law.stackexchange](https://law.stackexchange.com/questions/53359/how-can-i-use-a-trademark-name-in-my-app-title)）：① 不用它们的 logo/图形资产；② 只用文字提及、不超出必要；③ 不暗示赞助/背书——用 "inspired by" / "in the style of" + 页脚 disclaimer（"Kodak and Portra are trademarks of Eastman Kodak… not affiliated"）
- **app 名/store listing 不能含第三方品牌**（Google Play IP policy + Apple 4.1/2.3）→ app 名要自创（候选见 PLAN.md），listing 描述里可用描述性文字但不放品牌 logo
- 风险评级：**低**，前提是上述三条纪律 + 若被投诉可改滤镜命名（如 "Golden 200" 类自创名作 fallback）
