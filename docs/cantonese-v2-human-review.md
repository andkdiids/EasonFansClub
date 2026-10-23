# 番茄牛腩面不吃辣 · Cantonese V2 人工审核包

> 本文件对应隔离分支上的内容候选，仅供人工审核。所有候选仍是 `CONTENT_REVIEW_REQUIRED` / `HUMAN_REVIEW_REQUIRED`；没有批准、发布、部署、数据库写入、TTS 生成或 COS 上传。

## HIGH PRIORITY REVIEW

先处理歧义题、多音字、来源未知、课程重复和 Foundation 名称不一致。以下建议不修改原答案或原文。

### 4 个歧义题

#### cantonese.v6.question.lesson-05.thanks-multi
- Lesson：lesson-05
- 题干：哪些情境适合用本课的「唔該」或「多謝」？（多选）
- 选项：别人帮忙开门后说「唔該」 / 收到礼物后说「多謝」 / 碰撞别人后说「下次見」 / 问路前用「唔該」礼貌开场
- 当前答案：别人帮忙开门后说「唔該」 / 收到礼物后说「多謝」 / 问路前用「唔該」礼貌开场
- 当前解释：帮助和礼物场景是在道谢；问路前的「唔該」是礼貌开场，不是感谢。
- 歧义：题干把「感谢」和「唔該」作礼貌开场混在同一判断里；第三项并非感谢，当前选项却同时问“适合用”两种表达，学习目标不够单一。
- 建议：拆成“表达感谢”和“礼貌开场”两题，或明确题干按功能分类；人工确认后再设答案。
- 状态：HUMAN_REVIEW_REQUIRED

#### cantonese.v6.question.lesson-06.unknown-route
- Lesson：lesson-06
- 题干：如果你不确定车是否到某站，哪种回应较安全？
- 选项：坦白不确定，并请对方看站牌 / 估计是同一条线，叫对方先上车再看 / 凭上次乘车印象回答，不再核对 / 说「应该会到」，但不确认站名
- 当前答案：坦白不确定，并请对方看站牌
- 当前解释：真实出行信息应核对；凭印象猜测或给出含糊承诺都可能误导乘客。
- 歧义：考查现实出行安全常识，选项没有呈现对应粤语说法；它不能证明学习者掌握了本课粤语。
- 建议：改为辨认或选择一条经过审核的粤语确认句，或将安全提示移出计分题；当前答案不自动改动。
- 状态：HUMAN_REVIEW_REQUIRED

#### cantonese.v6.question.lesson-07.takeaway
- Lesson：lesson-07
- 题干：哪些词语可用于表达外带／拿走相关意思？（多选）
- 选项：外賣 / 堂食 / 拎走 / 埋單
- 当前答案：外賣 / 拎走
- 当前解释：两者都与外带场景有关，但句法位置与实际用法仍要结合语境；课程保留为审核候选。
- 歧义：「外賣」表示外带情境/餐食，「拎走」是动作表达；题目把不同句法角色概括成同一“词语意思”。
- 建议：拆分为“堂食/外賣”场景选择和含「拎走」的完整句理解题；先由粤语审核员确认自然语境。
- 状态：HUMAN_REVIEW_REQUIRED

#### cantonese.v6.question.lesson-07.payment-multi
- Lesson：lesson-07
- 题干：哪些属于合理的结账行为？（多选）
- 选项：说「唔該，埋單」 / 先询问是否支持八达通 / 假定任何店都支持同种支付方式 / 等店员确认
- 当前答案：说「唔該，埋單」 / 先询问是否支持八达通 / 等店员确认
- 当前解释：先提出结账、核对支付方式并等待确认。
- 歧义：多选项同时混合粤语表达、支付方式事实和服务流程，未明确考查词句还是行为规范。
- 建议：保留语言学习目标，改为辨认「埋單」或询问支付方式的表达；把等待店员确认留作非计分提示。
- 状态：HUMAN_REVIEW_REQUIRED

### 多音字与读音分歧

| ITEM_ID | LESSON | TEXT | JYUTPING_CANDIDATE | REASON | STATUS |
| --- | --- | --- | --- | --- | --- |
| cantonese.v6.content.lesson-05.bye | lesson-05 | 我走先喇，下次見。 | ngo5 zau2 sin1 laa3 haa6 ci3 gin3 | 「喇」有口语变体；请确认目标口音和语境读法。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d3b | lesson-05 | 唔緊要，你冇事吖嘛？ | m4 gan2 jiu3 nei5 mou5 si6 aa3 maa3 | 「吖嘛」口语粒子需由粤语审核员确认实际读法和写法。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.straight | lesson-06 | 一直行 | jat1 zik6 haang4 | 「行」在“步行”义读 haang4；仍请核对多音字及目标口音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.left | lesson-06 | 轉左 | zyun2 zo2 | 方向语境的「轉」可能有异读；候选 zyun2，需人工裁定。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.right | lesson-06 | 轉右 | zyun2 jau6 | 方向语境的「轉」可能有异读；候选 zyun2，需人工裁定。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.how-long | lesson-06 | 行過去要幾耐？ | haang4 gwo3 heoi3 jiu3 gei2 noi6 | 「行」在“步行”义读 haang4；请核对与「行過去」的连读。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d1b | lesson-06 | 一直行，前面個路口轉左。 | jat1 zik6 haang4 cin4 min6 go3 lou6 hau2 zyun2 zo2 | 「行」与方向义「轉」均需人工确认读音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d2a | lesson-06 | 行過去要幾耐？ | haang4 gwo3 heoi3 jiu3 gei2 noi6 | 「行」在“步行”义读 haang4；请核对目标口音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d2c | lesson-06 | 一直行，定係要轉彎？ | jat1 zik6 haang4 ding6 hai6 jiu3 zyun2 waan4 | 「行」与方向义「轉」均需人工确认读音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d2d | lesson-06 | 行到個路口轉右。 | haang4 dou3 go3 lou6 hau2 zyun2 jau6 | 「行」与方向义「轉」均需人工确认读音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d4b | lesson-06 | 一直行，第二個路口轉左。 | jat1 zik6 haang4 dai6 ji6 go3 lou6 hau2 zyun2 zo2 | 「行」與方向義「轉」均需人工確認讀音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d4c | lesson-06 | 第二個路口轉左，係咪？ | dai6 ji6 go3 lou6 hau2 zyun2 zo2 hai6 m4 hai6 | 方向義「轉」可能有異讀；候選 zyun2，需人工裁定。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d4d | lesson-06 | 係，行多陣就到。 | hai6 haang4 do1 zan6 zau6 dou3 | 「行」在“步行”义读 haang4；请核对目标口音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.order-drink | lesson-07 | 一杯凍檸茶，少冰，唔該。 | jat1 bui1 dung3 ning4 caa4 siu2 bing1 m4 goi1 | 「檸」在原有条目中有不一致候选 ning2/ning4；请以可靠粤语词典和目标口音核对。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d2a | lesson-07 | 我想要呢個，仲有一杯凍檸茶。 | ngo5 soeng2 jiu3 ni1 go3 zung6 jau5 jat1 bui1 dung3 ning4 caa4 | 「檸」在旧条目中已有不一致候选；请核对该字的读音。 | HUMAN_REVIEW_REQUIRED |

### 重复、来源和品牌名称问题

- **cantonese.v6.content.lesson-05.hello**（lesson-01 / lesson-05）：与迁入的 Lesson 01 词条完全重复；现有 Lesson 05 稳定 ID 不可静默删除。 建议：建议 Lesson 01 作为首次教学；Lesson 05 词条待审核后并入/改为上下文复现。 [HIGH; HUMAN_REVIEW_REQUIRED]
- **cantonese.v6.content.lesson-05.morning**（lesson-01 / lesson-05）：与迁入的 Lesson 01 词条完全重复；Lesson 05 对话另有真实语境复现。 建议：建议合并首次教学记录，保留 Lesson 05 对话；不自动移除旧记录。 [HIGH; HUMAN_REVIEW_REQUIRED]
- **cantonese.v6.content.lesson-06.left**（lesson-06）：「轉」在方向词组中的读音需核对多音及口音差异。 建议：暂存 Jyutping 候选 zyun2 zo2；请审核后裁定。 [LOW; HUMAN_REVIEW_REQUIRED]
- **cantonese.v6.content.lesson-06.right**（lesson-06）：「轉」在方向词组中的读音需核对多音及口音差异。 建议：暂存 Jyutping 候选 zyun2 jau6；请审核后裁定。 [LOW; HUMAN_REVIEW_REQUIRED]
- **cantonese.v6.content.lesson-06.straight**（lesson-06）：「行」有多个粤语读音；此处按“步行”义暂候选 haang4。 建议：逐字确认「行」在本语境的读音。 [LOW; HUMAN_REVIEW_REQUIRED]
- **cantonese.v6.content.lesson-07.order-drink**（lesson-07）：当前已有但未审核的 Jyutping 与本轮长句候选对「檸」使用不同声调。 建议：核查后统一所有包含「檸」的条目；不在本轮覆盖现有读音。 [LOW; HUMAN_REVIEW_REQUIRED]
- **foundation.nine-tones.phrase**（Foundation）：Mobile Foundation 使用的名称多一个「酱」，与正式功能名称不一致。 建议：人工确认是否统一为正式名称「番茄牛腩面不吃辣」。 [HIGH; HUMAN_REVIEW_REQUIRED]

#### 来源未知条目

- cantonese.v6.content.lesson-05.intro（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.im-good（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.excuse-question（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.gift-thanks（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.bye（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d1a（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d1b（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d1c（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d1d（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d2a（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d2b（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d2d（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d3a（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d3b（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d3c（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.d3d（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-05.self-compare（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.intro（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.straight（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.cross（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.next-stop（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.where-station（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.how-go（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.how-long（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.bus-go（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.please-repeat（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d1a（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d1b（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d1c（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d1d（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d1e（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d2a（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d2b（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d2c（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d2d（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d3a（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d3b（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d3c（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d3d（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d4a（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d4b（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d4c（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.d4d（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-06.review（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.intro（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.take-away-action（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.less-sweet（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.no-sweet（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.sweetness-contrast（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.two-people（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.want-this（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.order-drink（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.spicy-check（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.ice-contrast（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d1a（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d1b（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d1c（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d1d（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d2a（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d2b（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d2c（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d2d（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d2e（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d3a（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d3b（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d3c（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d3d（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d4a（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d4b（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d4c（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.d4d（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.self-compare（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.content.lesson-07.review（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.greet-morning（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.long-time（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.ask-help（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.gift（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.service（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.sorry-response（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.reply-how（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.bye-context（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.thanks-multi（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.apology-multi（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.thanks-false（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.review-true（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.listen-morning（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.listen-thanks（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.listen-apology（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.speak-morning（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.speak-help（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-05.challenge-open（lesson-05）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.where-vs-how（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.how-route（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.left（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.right（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.duration（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.bus-check（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.repeat（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.verify-left（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.unknown-route（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.direction-multi（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.safety-multi（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.where-true（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.route-false（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.listen-left（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.listen-right（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.listen-time（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.speak-station（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.speak-repeat（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.challenge-start（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-06.challenge-understand（lesson-06）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.seating（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.dine-or-take（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.takeaway（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.point-menu（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.ice-difference（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.sweetness（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.spice-question（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.spice-adjust（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.bill（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.pay-method（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.order-flow（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.payment-multi（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.ice-false（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.spice-true（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.listen-dine-in（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.listen-ice（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.listen-spicy（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.speak-order（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.speak-bill（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。
- cantonese.v6.question.lesson-07.challenge-sequence（lesson-07）：来源未能从候选记录确认；版权审查仍需完成。

### 风险分布

风险表示审核优先级，不代表批准状态。所有内容仍须正式审核。
| HIGH RISK | REVIEW | LOW RISK |
| --- | --- | --- |
| 135 | 23 | 57 |

## Course Question Summary

QUESTION_TOTAL=80; SINGLE_SELECT=52; MULTI_SELECT=7; TRUE_FALSE=6; LISTENING=9; SPEAKING=6.

## Foundation · 发音基础

- ID：foundation.nine-tones；顺序：业务 Lesson 之前；状态：CONTENT_REVIEW_REQUIRED。
- 规划：建议作为 Lesson 01 前置发音基础，不占用 Lesson 编号。
- 契约限制：当前 Server prerequisite 只接受前一业务 lesson；为避免改 schema，lesson-01 的 Server prerequisite 保持 null。Foundation 完成门禁尚未被 Server 契约表达。
- Mobile 当前功能名：番茄酱牛腩面不吃辣；正式名称：番茄牛腩面不吃辣。名称差异待人工确认，不修改 Mobile。

### 九个声调示例

| 字 | 粤拼候选 | 声调类别 | AUDIO_ID | STATUS |
| --- | --- | --- | --- | --- |
| 番 | faan1 | 1 · 陰平 | foundation.tone.faan1 | HUMAN_REVIEW_REQUIRED |
| 茄 | ke2 | 2 · 陰上 | foundation.tone.ke2 | HUMAN_REVIEW_REQUIRED |
| 酱 | zoeng3 | 3 · 陰去 | foundation.tone.zoeng3 | HUMAN_REVIEW_REQUIRED |
| 牛 | ngau4 | 4 · 陽平 | foundation.tone.ngau4 | HUMAN_REVIEW_REQUIRED |
| 腩 | naam5 | 5 · 陽上 | foundation.tone.naam5 | HUMAN_REVIEW_REQUIRED |
| 面 | min6 | 6 · 陽去 | foundation.tone.min6 | HUMAN_REVIEW_REQUIRED |
| 不 | bat1 | 1 · 陰入 | foundation.tone.bat1 | HUMAN_REVIEW_REQUIRED |
| 吃 | hek3 | 3 · 中入 | foundation.tone.hek3 | HUMAN_REVIEW_REQUIRED |
| 辣 | laat6 | 6 · 陽入 | foundation.tone.laat6 | HUMAN_REVIEW_REQUIRED |

- Foundation 示例短句：番茄酱牛腩面不吃辣；粤拼候选：faan1 ke2 zoeng3 ngau4 naam5 min6 bat1 hek3 laat6；音频 ID：foundation.phrase；状态：CONTENT_REVIEW_REQUIRED。
- 现有 Foundation 共 16 步，最后 3 步为测验；第三题需要真实音频，目前 BLOCKED_BY_AUDIO。

### Foundation 测验候选

- **foundation.nine-tones.quiz.01**（SINGLE_SELECT）：「茄 ke2」是第几声？；选项：1 / 2 / 3 / 4；候选答案：2；ke2 是第二声 · 阴上。；CONTENT_REVIEW_REQUIRED。
- **foundation.nine-tones.quiz.02**（SINGLE_SELECT）：「吃 hek3」属于哪一种入声？；选项：阴入 / 中入 / 阳入；候选答案：中入；hek3 以 -k 收尾，属于中入；粤拼仍写 3。；CONTENT_REVIEW_REQUIRED。
- **foundation.nine-tones.quiz.03**（LISTENING）：听发音，选出声调。；选项：3 / 4 / 5 / 6；候选答案：4；牛 ngau4 是第四声 · 阳平。；BLOCKED_BY_AUDIO。

## Lesson 01–07

Lesson 05–07 保留原 ID；Lesson 01–04 使用新的 Server 候选 ID。每课目标、内容、问题和音频需求如下。

### Lesson 01 · 你好

- 教学目标：认识你好、早晨和拜拜，并在简单场景中辨认文字与粤拼。
- ID：lesson-01；顺序：1；前置：null；状态：CONTENT_REVIEW_REQUIRED
- 题目数：6；音频槽位：3；LISTENING：0（BLOCKED_BY_AUDIO）；SPEAKING：0（不评分）。

#### 词汇

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 你好 | nei5 hou2 | 你好；日常见面的问候语。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 早晨 | zou2 san4 | 早上好 / 早安。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 拜拜 | baai1 baai3 | 再见；口语告别。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |

#### 题目

- **cantonese.v6.question.lesson-01.morning-meaning**（SINGLE_SELECT）
  - 题干：「早晨」是什么意思？
  - 选项：a. 早上好；b. 晚安；c. 谢谢；d. 再见
  - 当前答案：早上好
  - 当前解释：「早晨」是早上见面时的问候；此释义仍待人工审核。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-01.greeting-situation**（SINGLE_SELECT）
  - 题干：早上见到朋友，哪句最合适？
  - 选项：a. 早晨；b. 拜拜；c. 我叫小明。；d. 唔係
  - 当前答案：早晨
  - 当前解释：按题目中的早上见面情境选择问候语。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-01.match-hello-jyutping**（SINGLE_SELECT）
  - 题干：「你好」对应哪组粤拼？
  - 选项：a. nei5 hou2；b. nei5 dei6；c. baai1 baai3；d. zou2 san4
  - 当前答案：nei5 hou2
  - 当前解释：逐项核对文字与粤拼；读音尚未人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-01.match-morning-jyutping**（SINGLE_SELECT）
  - 题干：「早晨」对应哪组粤拼？
  - 选项：a. hou2 noi6 mou5 gin3；b. zou2 san4；c. nei5 hou2；d. baai1 baai3
  - 当前答案：zou2 san4
  - 当前解释：逐项核对文字与粤拼；读音尚未人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-01.match-bye-jyutping**（SINGLE_SELECT）
  - 题干：「拜拜」对应哪组粤拼？
  - 选项：a. nei5 hou2；b. zou2 san4；c. baai1 baai3；d. ngo5 nei5
  - 当前答案：baai1 baai3
  - 当前解释：逐项核对文字与粤拼；读音尚未人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-01.order-hello**（SINGLE_SELECT）
  - 题干：选出正确写法：「你好」
  - 选项：a. 好你；b. 你好；c. 你我；d. 早好
  - 当前答案：你好
  - 当前解释：选择课程中的目标问候语书写。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED

#### 音频

需要 3 个音频槽位；当前全部待文本及粤拼审核，未生成音频。

### Lesson 02 · 我、你、佢

- 教学目标：辨认我、你、佢和你哋，并将常用人称与粤拼对应。
- ID：lesson-02；顺序：2；前置：lesson-01；状态：CONTENT_REVIEW_REQUIRED
- 题目数：5；音频槽位：4；LISTENING：0（BLOCKED_BY_AUDIO）；SPEAKING：0（不评分）。

#### 词汇

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 我 | ngo5 | 说话的人自己。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 你 | nei5 | 正在交谈的对方。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 佢 | keoi5 | 他 / 她；粤语书写不区分这两个“他”。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 你哋 | nei5 dei6 | 你们。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |

#### 题目

- **cantonese.v6.question.lesson-02.pronoun-he**（SINGLE_SELECT）
  - 题干：「佢」通常指谁？
  - 选项：a. 我自己；b. 正在听的人；c. 他 / 她；d. 我们
  - 当前答案：他 / 她
  - 当前解释：粤语「佢」不区分中文书写里的“他”和“她”。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-02.match-i-jyutping**（SINGLE_SELECT）
  - 题干：「我」对应哪组粤拼？
  - 选项：a. ngo5；b. nei5；c. keoi5；d. nei5 dei6
  - 当前答案：ngo5
  - 当前解释：逐项核对人称与粤拼；读音尚未人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-02.match-you-jyutping**（SINGLE_SELECT）
  - 题干：「你」对应哪组粤拼？
  - 选项：a. ngo5；b. nei5；c. keoi5；d. nei5 dei6
  - 当前答案：nei5
  - 当前解释：逐项核对人称与粤拼；读音尚未人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-02.match-he-jyutping**（SINGLE_SELECT）
  - 题干：「佢」对应哪组粤拼？
  - 选项：a. ngo5；b. nei5；c. keoi5；d. nei5 dei6
  - 当前答案：keoi5
  - 当前解释：逐项核对人称与粤拼；读音尚未人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-02.you-plural-meaning**（SINGLE_SELECT）
  - 题干：「你哋」是什么意思？
  - 选项：a. 你；b. 你们；c. 他们；d. 我
  - 当前答案：你们
  - 当前解释：「哋」与人称搭配时可表示复数；具体讲解待人工审核。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED

#### 音频

需要 4 个音频槽位；当前全部待文本及粤拼审核，未生成音频。

### Lesson 03 · 我叫……

- 教学目标：介绍自己的名字，询问对方姓名，并用「你呢？」继续对话。
- ID：lesson-03；顺序：3；前置：lesson-02；状态：CONTENT_REVIEW_REQUIRED
- 题目数：5；音频槽位：5；LISTENING：0（BLOCKED_BY_AUDIO）；SPEAKING：0（不评分）。

#### 词汇

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 咩 | me1 | 什么；常见口语用法。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 名 | meng2 | 名字 / 名称。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 你呢？ | nei5 ne1 | 你呢？ / 那你呢？ | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 我叫小明。 | ngo5 giu3 siu2 ming4 | 我的名字是小明。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 你叫咩名呀？ | nei5 giu3 me1 meng2 aa3 | 你叫什么名字？（自然口语问法） | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |

#### 题目

- **cantonese.v6.question.lesson-03.ask-name-meaning**（SINGLE_SELECT）
  - 题干：「你叫咩名呀？」是什么意思？
  - 选项：a. 你在哪里？；b. 你叫什么名字？；c. 吃饭了吗？；d. 早上好。
  - 当前答案：你叫什么名字？
  - 当前解释：「咩」在这个问句中表示“什么”；释义和语气待人工审核。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-03.what-meaning**（SINGLE_SELECT）
  - 题干：「咩」在本课问句中对应哪个意思？
  - 选项：a. 谁；b. 什么；c. 哪里；d. 什么时候
  - 当前答案：什么
  - 当前解释：根据「你叫咩名呀？」的上下文理解词义。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-03.name-meaning**（SINGLE_SELECT）
  - 题干：「名」在「你叫咩名呀？」中指什么？
  - 选项：a. 名字；b. 地方；c. 时间；d. 食物
  - 当前答案：名字
  - 当前解释：这里「名」与询问姓名有关；单字读音须人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-03.order-my-name**（SINGLE_SELECT）
  - 题干：选出正确句子：「我的名字是小明。」
  - 选项：a. 小明叫我。；b. 我叫小明。；c. 你叫小明。；d. 我小明叫。
  - 当前答案：我叫小明。
  - 当前解释：选择本课的自我介绍句式。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-03.answer-introduction**（SINGLE_SELECT）
  - 题干：有人问「你叫咩名呀？」，哪句可以回答自己的名字？
  - 选项：a. 我叫小明。；b. 早晨。；c. 拜拜。；d. 你叫咩名呀？
  - 当前答案：我叫小明。
  - 当前解释：用「我叫……」回答自己的名字；示例姓名可替换。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED

#### 音频

需要 5 个音频槽位；当前全部待文本及粤拼审核，未生成音频。

### Lesson 04 · 係 / 唔係

- 教学目标：区分「係」「唔係」「係咪」，并练习肯定和否定判断。
- ID：lesson-04；顺序：4；前置：lesson-03；状态：CONTENT_REVIEW_REQUIRED
- 题目数：6；音频槽位：6；LISTENING：0（BLOCKED_BY_AUDIO）；SPEAKING：0（不评分）。

#### 词汇

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 係 | hai6 | 是 / 对；用于判断或确认。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 唔係 | m4 hai6 | 不是。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 係咪 | hai6 mai6 | 是不是；常用于是非问句。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 你係咪小明呀？ | nei5 hai6 mai6 siu2 ming4 aa3 | 你是小明吗？ | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 我唔係小明。 | ngo5 m4 hai6 siu2 ming4 | 我不是小明。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |
| 我係小明。 | ngo5 hai6 siu2 ming4 | 我是小明。 | CONTENT_REVIEW_REQUIRED | ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review. |

#### 题目

- **cantonese.v6.question.lesson-04.not-meaning**（SINGLE_SELECT）
  - 题干：「唔係」是什么意思？
  - 选项：a. 是；b. 不是；c. 谁；d. 哪里
  - 当前答案：不是
  - 当前解释：「唔係」表示否定判断；释义仍需人工审核。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-04.match-is-meaning**（SINGLE_SELECT）
  - 题干：「係」最接近哪个意思？
  - 选项：a. 是 / 对；b. 不是；c. 是不是；d. 再见
  - 当前答案：是 / 对
  - 当前解释：根据本课判断句理解；具体用法需要人工审核。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-04.match-is-not-meaning**（SINGLE_SELECT）
  - 题干：「唔係」最接近哪个意思？
  - 选项：a. 是 / 对；b. 不是；c. 是不是；d. 再见
  - 当前答案：不是
  - 当前解释：注意否定词「唔」；读音和语法仍需人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-04.match-is-question-meaning**（SINGLE_SELECT）
  - 题干：「係咪」最接近哪个意思？
  - 选项：a. 是；b. 不是；c. 是不是；d. 再见
  - 当前答案：是不是
  - 当前解释：「係咪」在本课用于是非问句。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-04.order-negative**（SINGLE_SELECT）
  - 题干：选出正确句子：「我不是小明。」
  - 选项：a. 小明我唔係。；b. 我唔係小明。；c. 我係小明。；d. 你係咪小明呀？
  - 当前答案：我唔係小明。
  - 当前解释：选择本课的否定判断句。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-04.affirmative-answer**（SINGLE_SELECT）
  - 题干：听到「你係咪小明呀？」，回答“是”，可以选哪句？
  - 选项：a. 係，我係小明。；b. 早晨。；c. 拜拜。；d. 你叫咩名呀？
  - 当前答案：係，我係小明。
  - 当前解释：用「係」作肯定回答；完整答句为候选表达。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED

#### 音频

需要 6 个音频槽位；当前全部待文本及粤拼审核，未生成音频。

### Lesson 05 · 打招呼與基本交流

- 教学目标：在见面、道谢、道歉和请求帮助等日常场景中选择合适表达。
- ID：lesson-05；顺序：5；前置：lesson-04；状态：CONTENT_REVIEW_REQUIRED
- 题目数：18；音频槽位：29；LISTENING：3（BLOCKED_BY_AUDIO）；SPEAKING：2（不评分）。

#### 词汇

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 早晨 | zou2 san4 | 早上好 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/早晨 |
| 你好 | nei5 hou2 | 你好 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/你好 |
| 好耐冇見 | hou2 noi6 mou5 gin3 | 好久不见 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/見 |
| 唔該 | m4 goi1 | 劳驾／谢谢帮忙 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/唔該 |
| 多謝 | do1 ze6 | 谢谢 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/多謝 |
| 唔使客氣 | m4 sai2 haak3 hei3 | 不用客气 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/唔使客氣 |
| 對唔住 | deoi3 m4 zyu6 | 对不起 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/對唔住 |
| 唔緊要 | m4 gan2 jiu3 | 没关系 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/唔緊要 |
| 下次見 | haa6 ci3 gin3 | 下次见 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/見 |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 唔該晒 | m4 goi1 saai3 | 非常感谢 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/唔該 |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 近排點呀？ | gan6 paai4 dim2 aa3 | 最近怎么样？ | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/喂 |
| 我幾好，你呢？ | ngo5 gei2 hou2 nei5 ne1 | 我还不错，你呢？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該，想問你一樣嘢。 | m4 goi1 soeng2 man6 nei5 jat1 joeng6 je5 | 劳驾，我想问你一件事。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 多謝你送畀我。 | do1 ze6 nei5 sung3 bei2 ngo5 | 谢谢你送给我。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 我走先喇，下次見。 | ngo5 zau2 sin1 laa3 haa6 ci3 gin3 | 我先走了，下次见。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 对话

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 早晨！好耐冇見。 | zou2 san4 hou2 noi6 mou5 gin3 | 早上好，好久不见。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 係呀，近排點呀？ | hai6 aa3 gan6 paai4 dim2 aa3 | 是啊，最近怎么样？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 我幾好，你呢？ | ngo5 gei2 hou2 nei5 ne1 | 我还不错，你呢？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 我都幾好。得閒再傾！ | ngo5 dou1 gei2 hou2 dak1 haan4 zoi3 king1 | 我也还好，有空再聊。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該，可唔可以幫我開門？ | m4 goi1 ho2 m4 ho2 ji5 bong1 ngo5 hoi1 mun4 | 劳驾，可以帮我开门吗？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 得，冇問題。 | dak1 mou5 man6 tai4 | 可以，没问题。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該晒！ | m4 goi1 saai3 | 十分感谢。 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/唔該 |
| 唔使客氣。 | m4 sai2 haak3 hei3 | 不用客气。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 對唔住，我冇留意。 | deoi3 m4 zyu6 ngo5 mou5 lau4 ji3 | 对不起，我没留意。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔緊要，你冇事吖嘛？ | m4 gan2 jiu3 nei5 mou5 si6 aa3 maa3 | 没关系，你没事吧？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 冇事，多謝你。 | mou5 si6 do1 ze6 nei5 | 没事，谢谢你。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 咁就好，拜拜。 | gam2 zau6 hou2 baai1 baai3 | 那就好，再见。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 对比项

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 唔該／多謝 | m4 goi1 / do1 ze6 | 两种“谢谢”要看情境 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/唔該 ; https://words.hk/zidin/唔使客氣 ; https://words.hk/zidin/見 ; https://words.hk/zidin/多謝 |

#### 跟读材料

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 唔該，可唔可以幫我開門？ | m4 goi1 ho2 m4 ho2 ji5 bong1 ngo5 hoi1 mun4 | 练习礼貌请求 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 题目

- **cantonese.v6.question.lesson-05.greet-morning**（SINGLE_SELECT）
  - 题干：早上遇到熟人，想明确说“早上好”，选哪句？
  - 选项：a. 早晨！；b. 好耐冇見！；c. 近排點呀？；d. 下次見！
  - 当前答案：早晨！
  - 当前解释：几句都可能用于寒暄，但只有「早晨」明确是早上招呼。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.long-time**（SINGLE_SELECT）
  - 题干：很久没见的朋友再见面，哪句直接点出“好久不见”？
  - 选项：a. 好耐冇見。；b. 近排點呀？；c. 我幾好，你呢？；d. 下次見。
  - 当前答案：好耐冇見。
  - 当前解释：几句都可出现在同一段寒暄中，但「好耐冇見」直接说明久未相见。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.ask-help**（SINGLE_SELECT）
  - 题干：想请人帮忙开门，哪句较有礼貌？
  - 选项：a. 唔該，可唔可以幫我開門？；b. 你幫我開門啦。；c. 多謝你幫我開門。；d. 對唔住，我冇留意。
  - 当前答案：唔該，可唔可以幫我開門？
  - 当前解释：第一句在请求尚未完成时使用；「多謝」是事后的感谢。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.gift**（SINGLE_SELECT）
  - 题干：朋友送你礼物，本课建议优先选哪个道谢词？
  - 选项：a. 多謝；b. 唔緊要；c. 對唔住；d. 下次見
  - 当前答案：多謝
  - 当前解释：感谢明显的赠礼可用「多謝」；最终用法仍须审核。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.service**（SINGLE_SELECT）
  - 题干：别人帮你推开门后，本课对话用哪句道谢？
  - 选项：a. 唔該晒！；b. 唔使客氣。；c. 對唔住。；d. 我冇留意。
  - 当前答案：唔該晒！
  - 当前解释：「唔該晒」感谢帮助；「唔使客氣」由对方回应。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.sorry-response**（SINGLE_SELECT）
  - 题干：有人轻轻碰到你并道歉，可怎样回应？
  - 选项：a. 唔緊要。；b. 多謝你送畀我。；c. 我走先喇。；d. 可唔可以幫我開門？
  - 当前答案：唔緊要。
  - 当前解释：「唔緊要」可回应轻微道歉。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.reply-how**（SINGLE_SELECT）
  - 题干：对方问「近排點呀？」，哪句是自然接话？
  - 选项：a. 我幾好，你呢？；b. 好耐冇見，你呢？；c. 多謝你送畀我。；d. 我走先喇，下次見。
  - 当前答案：我幾好，你呢？
  - 当前解释：先回答自己的近况，再回问对方；其余分别是重新寒暄、收礼道谢和告别。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.bye-context**（SINGLE_SELECT）
  - 题干：准备结束短谈时，哪句更贴合？
  - 选项：a. 我走先喇，下次見。；b. 可唔可以幫我開門？；c. 對唔住，我冇留意。；d. 你冇事吖嘛？
  - 当前答案：我走先喇，下次見。
  - 当前解释：「我走先喇，下次見」用于告别。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.thanks-multi**（MULTI_SELECT）
  - 题干：哪些情境适合用本课的「唔該」或「多謝」？（多选）
  - 选项：a. 别人帮忙开门后说「唔該」；b. 收到礼物后说「多謝」；c. 碰撞别人后说「下次見」；d. 问路前用「唔該」礼貌开场
  - 当前答案：别人帮忙开门后说「唔該」；收到礼物后说「多謝」；问路前用「唔該」礼貌开场
  - 当前解释：帮助和礼物场景是在道谢；问路前的「唔該」是礼貌开场，不是感谢。
  - 审核问题：题干把「感谢」和「唔該」作礼貌开场混在同一判断里；第三项并非感谢，当前选项却同时问“适合用”两种表达，学习目标不够单一。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.apology-multi**（MULTI_SELECT）
  - 题干：轻微碰撞的对话中，哪些表达可以自然出现？（多选）
  - 选项：a. 道歉者说「對唔住」；b. 对方说「唔緊要」；c. 道歉者说「走冰」；d. 对方关心「你冇事吖嘛？」
  - 当前答案：道歉者说「對唔住」；对方说「唔緊要」；对方关心「你冇事吖嘛？」
  - 当前解释：道歉、体谅和关心可按对话角色依次衔接。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.thanks-false**（TRUE_FALSE）
  - 题干：「唔該」和「多謝」在所有场景都可以无差别交换。
  - 选项：a. 正确；b. 错误
  - 当前答案：错误
  - 当前解释：两词侧重的场合不同，不能机械互换。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.review-true**（TRUE_FALSE）
  - 题干：课程对话里，「唔使客氣」可用于回应别人道谢。
  - 选项：a. 正确；b. 错误
  - 当前答案：正确
  - 当前解释：本课帮助对话即这样使用。
  - 审核问题：解释偏浅；建议：「唔使客氣」在本课对话里回应对方的道谢；请人工确认该场景中的语气、文字和读音。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-05.listen-morning**（LISTENING）
  - 题干：听标准音，选择听到的招呼。
  - 选项：a. 早晨；b. 多謝；c. 對唔住；d. 唔緊要
  - 当前答案：早晨
  - 当前解释：音频与「早晨」候选资产绑定；未 READY 不可审核通过。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-05.listen-thanks**（LISTENING）
  - 题干：听标准音，选择听到的道谢语。
  - 选项：a. 唔該晒；b. 下次見；c. 好耐冇見；d. 唔使客氣
  - 当前答案：唔該晒
  - 当前解释：音频与「唔該晒」候选资产绑定。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-05.listen-apology**（LISTENING）
  - 题干：听标准音，选择听到的回应。
  - 选项：a. 唔緊要，你冇事吖嘛？；b. 我幾好，你呢？；c. 得，冇問題。；d. 我走先喇。
  - 当前答案：唔緊要，你冇事吖嘛？
  - 当前解释：音频与道歉对话 B 的原句绑定。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-05.speak-morning**（SPEAKING）
  - 题干：情景：早上遇到熟人。听标准音，录下「早晨」并自行比较。
  - 选项：无（口语练习不评分）
  - 当前答案：无（不评分）
  - 当前解释：本题只做本机 A/B 回听，不给 AI 分数。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；UNSCORED_NON_GRADEABLE
- **cantonese.v6.question.lesson-05.speak-help**（SPEAKING）
  - 题干：情景：请别人帮你开门。听标准音，录下礼貌请求并自行比较。
  - 选项：无（口语练习不评分）
  - 当前答案：无（不评分）
  - 当前解释：对照课程的完整请求句，自主回听。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；UNSCORED_NON_GRADEABLE
- **cantonese.v6.question.lesson-05.challenge-open**（SINGLE_SELECT）
  - 题干：情景挑战：陌生人帮你开了门，下一句怎样自然衔接？
  - 选项：a. 唔該晒！；b. 好耐冇見！；c. 我冇留意。；d. 你冇事吖嘛？
  - 当前答案：唔該晒！
  - 当前解释：对帮助致谢，接着可听到「唔使客氣」。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED

#### 音频

需要 29 个音频槽位；当前全部待文本及粤拼审核，未生成音频。

### Lesson 06 · 問路與出行

- 教学目标：询问地点和路线，听清方向后用短句复述确认。
- ID：lesson-06；顺序：6；前置：lesson-05；状态：CONTENT_REVIEW_REQUIRED
- 题目数：20；音频槽位：32；LISTENING：3（BLOCKED_BY_AUDIO）；SPEAKING：2（不评分）。

#### 词汇

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 地鐵站 | dei6 tit3 zaam6 | 港铁车站 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/地鐵站 |
| 邊度 | bin1 dou6 | 哪里 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/度 |
| 點樣 | dim2 joeng2 | 怎样 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/點 |
| 一直行 | jat1 zik6 haang4 | 一直走 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 轉左 | zyun2 zo2 | 向左转 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/轉 |
| 轉右 | zyun2 jau6 | 向右转 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/轉 |
| 過馬路 | gwo3 maa5 lou6 | 过马路 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 下一站 | haa6 jat1 zaam6 | 下一站 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 前面個路口 | cin4 min6 go3 lou6 hau2 | 前面的路口 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/路口 |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 唔好意思，地鐵站喺邊度？ | m4 hou2 ji3 si3 dei6 tit3 zaam6 hai2 bin1 dou6 | 不好意思，地铁站在哪里？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 請問點樣去地鐵站？ | cing2 man6 dim2 joeng2 heoi3 dei6 tit3 zaam6 | 请问怎样去地铁站？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 行過去要幾耐？ | haang4 gwo3 heoi3 jiu3 gei2 noi6 | 走过去要多久？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 呢架車去唔去旺角？ | ni1 gaa3 ce1 heoi3 m4 heoi3 wong6 gok3 | 这辆车去不去旺角？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該，可唔可以講多次？ | m4 goi1 ho2 m4 ho2 ji5 gong2 do1 ci3 | 劳驾，可以再说一次吗？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 对话

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 唔好意思，地鐵站喺邊度？ | m4 hou2 ji3 si3 dei6 tit3 zaam6 hai2 bin1 dou6 | 不好意思，港铁站在哪里？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 一直行，前面個路口轉左。 | jat1 zik6 haang4 cin4 min6 go3 lou6 hau2 zyun2 zo2 | 一直走，在前面路口左转。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 係咪過咗馬路就到？ | hai6 m4 hai6 gwo3 zo2 maa5 lou6 zau6 dou3 | 是不是过了马路就到了？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 係，過咗馬路就見到。 | hai6 gwo3 zo2 maa5 lou6 zau6 gin3 dou3 | 是，过马路就看见。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該晒！ | m4 goi1 saai3 | 十分感谢。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 行過去要幾耐？ | haang4 gwo3 heoi3 jiu3 gei2 noi6 | 走过去要多久？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 大概十分鐘。 | daai6 koi3 sap6 fan1 zung1 | 大约十分钟。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 一直行，定係要轉彎？ | jat1 zik6 haang4 ding6 hai6 jiu3 zyun2 waan4 | 一直走，还是要转弯？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 行到個路口轉右。 | haang4 dou3 go3 lou6 hau2 zyun2 jau6 | 走到路口右转。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該，呢架車去唔去旺角？ | m4 goi1 ni1 gaa3 ce1 heoi3 m4 heoi3 wong6 gok3 | 劳驾，这辆车去不去旺角？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 去，你可以上車。 | heoi3 nei5 ho2 ji5 soeng5 ce1 | 去，你可以上车。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 請問喺邊個站落車？ | cing2 man6 hai2 bin1 go3 zaam6 lok6 ce1 | 请问在哪一站下车？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 我唔肯定，你睇下車上面嘅站牌。 | ngo5 m4 ding6 nei5 tai2 haa5 ce1 soeng6 min6 ge3 zaam6 paai4 | 我不确定，请看车上的站牌。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該，可唔可以講多次？ | m4 goi1 ho2 m4 ho2 ji5 gong2 do1 ci3 | 劳驾，可以再说一次吗？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 一直行，第二個路口轉左。 | jat1 zik6 haang4 dai6 ji6 go3 lou6 hau2 zyun2 zo2 | 一直走，在第二个路口左转。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 第二個路口轉左，係咪？ | dai6 ji6 go3 lou6 hau2 zyun2 zo2 hai6 m4 hai6 | 第二个路口左转，对吗？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 係，行多陣就到。 | hai6 haang4 do1 zan6 zau6 dou3 | 对，再走一会儿就到了。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 对比项

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 喺邊度？／點樣去？ | hai2 bin1 dou6 / dim2 joeng2 heoi3 | 位置／方法 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/度 ; https://words.hk/zidin/點 |

#### 题目

- **cantonese.v6.question.lesson-06.where-vs-how**（SINGLE_SELECT）
  - 题干：只想问港铁站的位置，选哪句？
  - 选项：a. 地鐵站喺邊度？；b. 點樣去地鐵站？；c. 行過去要幾耐？；d. 喺邊個站落車？
  - 当前答案：地鐵站喺邊度？
  - 当前解释：几句都与出行有关；「喺邊度」最直接询问地点。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.how-route**（SINGLE_SELECT）
  - 题干：想知道去港铁站的走法，选哪句？
  - 选项：a. 點樣去地鐵站？；b. 地鐵站喺邊度？；c. 行過去要幾耐？；d. 喺邊個站落車？
  - 当前答案：點樣去地鐵站？
  - 当前解释：「點樣去」问方法或路线，不是只问位置、时间或下车站。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.left**（SINGLE_SELECT）
  - 题干：对方说「轉左」，你应往哪边？
  - 选项：a. 左边；b. 右边；c. 直走不转；d. 原路返回
  - 当前答案：左边
  - 当前解释：左、右不可混淆。
  - 审核问题：解释偏浅；建议：在本题的路线语境里，「轉左」表示向左转；「轉」的方向义粤拼候选仍待确认。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.right**（SINGLE_SELECT）
  - 题干：哪句包含「右转」的意思？
  - 选项：a. 行到個路口轉右。；b. 前面個路口轉左。；c. 一直行唔使轉。；d. 過咗馬路就見到。
  - 当前答案：行到個路口轉右。
  - 当前解释：「轉右」表示右转。
  - 审核问题：解释偏浅；建议：在本题的路线语境里，「轉右」表示向右转；请结合路口场景核对表达与读音。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.duration**（SINGLE_SELECT）
  - 题干：想问步行需要多久，哪句合适？
  - 选项：a. 行過去要幾耐？；b. 點樣去地鐵站？；c. 喺邊個站落車？；d. 第二個路口轉左，係咪？
  - 当前答案：行過去要幾耐？
  - 当前解释：「幾耐」这里问时长；其余问路线、站名或核对方向。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.bus-check**（SINGLE_SELECT）
  - 题干：上车前想确认这条车线是否到旺角，选哪句？
  - 选项：a. 呢架車去唔去旺角？；b. 點樣去旺角？；c. 行過去要幾耐？；d. 喺邊個站落車？
  - 当前答案：呢架車去唔去旺角？
  - 当前解释：A 直接确认这条车线是否前往目的地；B 问去旺角的方法，C 问步行时间，D 问下车站。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.repeat**（SINGLE_SELECT）
  - 题干：没听清方向，应怎样礼貌请对方重说？
  - 选项：a. 唔該，可唔可以講多次？；b. 一直行，前面轉左。；c. 下一站喺旺角落車。；d. 過咗馬路就到。
  - 当前答案：唔該，可唔可以講多次？
  - 当前解释：其他选项是路线信息，不是请对方重复；听不清时应先核对。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.verify-left**（SINGLE_SELECT）
  - 题干：对方说第二个路口左转，哪句是在核对信息？
  - 选项：a. 第二個路口轉左，係咪？；b. 一直行，定係要轉彎？；c. 呢架車去唔去旺角？；d. 我唔肯定。
  - 当前答案：第二個路口轉左，係咪？
  - 当前解释：复述路口和方向并以「係咪」确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.unknown-route**（SINGLE_SELECT）
  - 题干：如果你不确定车是否到某站，哪种回应较安全？
  - 选项：a. 坦白不确定，并请对方看站牌；b. 估计是同一条线，叫对方先上车再看；c. 凭上次乘车印象回答，不再核对；d. 说「应该会到」，但不确认站名
  - 当前答案：坦白不确定，并请对方看站牌
  - 当前解释：真实出行信息应核对；凭印象猜测或给出含糊承诺都可能误导乘客。
  - 审核问题：考查现实出行安全常识，选项没有呈现对应粤语说法；它不能证明学习者掌握了本课粤语。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.direction-multi**（MULTI_SELECT）
  - 题干：哪些属于步行方向信息？（多选）
  - 选项：a. 一直行；b. 轉左；c. 轉右；d. 坐地鐵去下一站
  - 当前答案：一直行；轉左；轉右
  - 当前解释：直行、左转、右转都是步行路线信息；乘地铁属于交通方式。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.safety-multi**（MULTI_SELECT）
  - 题干：问路时哪些做法有助于确认路线？（多选）
  - 选项：a. 听不清就请对方再说一次；b. 复述左右方向；c. 乘车前看站牌；d. 不看交通灯直接横穿马路
  - 当前答案：听不清就请对方再说一次；复述左右方向；乘车前看站牌
  - 当前解释：不确定时多确认，过马路仍须遵守交通规则。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.where-true**（TRUE_FALSE）
  - 题干：「喺邊度」可用于问某个地点在哪里。
  - 选项：a. 正确；b. 错误
  - 当前答案：正确
  - 当前解释：这是地点问句。
  - 审核问题：解释偏浅；建议：「喺」在此标示地点，「邊度」询问位置；组合后可用于询问某处在哪里。语法讲解待粤语审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.route-false**（TRUE_FALSE）
  - 题干：课程对话中的示例车次和时长可以直接作为现实导航承诺。
  - 选项：a. 正确；b. 错误
  - 当前答案：错误
  - 当前解释：出行须核对即时路线、班次与路况。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.listen-left**（LISTENING）
  - 题干：听标准音，选择对方指示的方向。
  - 选项：a. 左转；b. 右转；c. 坐车；d. 回头
  - 当前答案：左转
  - 当前解释：标准音绑定「一直行，前面個路口轉左」。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-06.listen-right**（LISTENING）
  - 题干：听标准音，选出对方说的路线。
  - 选项：a. 到路口右转；b. 到路口左转；c. 过桥后下车；d. 原路返回
  - 当前答案：到路口右转
  - 当前解释：标准音绑定「行到個路口轉右」。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-06.listen-time**（LISTENING）
  - 题干：听标准音，对方说步行大概多久？
  - 选项：a. 十分钟；b. 五分钟；c. 半小时；d. 没说
  - 当前答案：十分钟
  - 当前解释：听示例回答；非真实地理时长。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-06.speak-station**（SPEAKING）
  - 题干：情景：礼貌问陌生人港铁站在哪里。听标准音、录音并自行比较。
  - 选项：无（口语练习不评分）
  - 当前答案：无（不评分）
  - 当前解释：本机录音 A/B 比较，不评分。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；UNSCORED_NON_GRADEABLE
- **cantonese.v6.question.lesson-06.speak-repeat**（SPEAKING）
  - 题干：情景：没听清路线。跟读礼貌地请对方再说一次。
  - 选项：无（口语练习不评分）
  - 当前答案：无（不评分）
  - 当前解释：重点练礼貌请求，不上传语音。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；UNSCORED_NON_GRADEABLE
- **cantonese.v6.question.lesson-06.challenge-start**（SINGLE_SELECT）
  - 题干：情景挑战：你迷路了，想先问港铁站在哪里，哪句最切合？
  - 选项：a. 唔好意思，請問港鐵站喺邊度？；b. 唔該，可唔可以講多次？；c. 呢架車去唔去旺角？；d. 行過去要幾耐？
  - 当前答案：唔好意思，請問港鐵站喺邊度？
  - 当前解释：先礼貌询问目标地点；其他选项分别是请人重说、确认车线和询问步行时间。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-06.challenge-understand**（SINGLE_SELECT）
  - 题干：情景挑战：听到「一直行，第二個路口轉左」，应该怎样走？
  - 选项：a. 先直走，在第二个路口左转；b. 第一个路口右转；c. 直接上车；d. 过马路后立刻回头
  - 当前答案：先直走，在第二个路口左转
  - 当前解释：把动作次序和第几个路口都听完整。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED

#### 音频

需要 32 个音频槽位；当前全部待文本及粤拼审核，未生成音频。

### Lesson 07 · 餐廳點餐

- 教学目标：练习堂食外卖、点餐、饮品要求、确认辣度和结账表达。
- ID：lesson-07；顺序：7；前置：lesson-06；状态：CONTENT_REVIEW_REQUIRED
- 题目数：20；音频槽位：37；LISTENING：3（BLOCKED_BY_AUDIO）；SPEAKING：2（不评分）。

#### 词汇

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 堂食 | tong4 sik6 | 店内用餐 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/堂食 |
| 外賣 | ngoi6 maai6 | 外带／外卖 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/外賣 |
| 拎走 | ling1 zau2 | 拿走／带走 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 落單 | lok6 daan1 | 下单 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/落單 |
| 埋單 | maai4 daan1 | 结账 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/埋單 |
| 少冰 | siu2 bing1 | 少放冰 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/冰 |
| 走冰 | zau2 bing1 | 不加冰 | CONTENT_REVIEW_REQUIRED | https://www.cantonese.sheik.co.uk/dictionary/words/17572/ |
| 少甜 | siu2 tim4 | 甜度少一点 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 走甜 | zau2 tim4 | 不加糖／不加甜味 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔要辣 | m4 jiu3 laat6 | 不要辣 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/辣 |
| 凍檸茶 | dung3 ning2 caa4 | 冰柠檬茶 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/檸茶 |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 少冰，唔該 | siu2 bing1 m4 goi1 | 少放冰，谢谢／劳驾 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/冰 ; https://words.hk/zidin/唔該 |

#### 句子 / 短语

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 兩位，唔該。 | loeng5 wai2 m4 goi1 | 两位，谢谢／劳驾。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 我想要呢個。 | ngo5 soeng2 jiu3 ni1 go3 | 我想要这个。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 一杯凍檸茶，少冰，唔該。 | jat1 bui1 dung3 ning4 caa4 siu2 bing1 m4 goi1 | 一杯冰柠檬茶，少冰，劳驾。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 呢個辣唔辣？ | ni1 go3 laat6 m4 laat6 | 这个辣不辣？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該，埋單。 | m4 goi1 maai4 daan1 | 劳驾，结账。 | CONTENT_REVIEW_REQUIRED | https://words.hk/zidin/埋單 |

#### 对话

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 幾多位？ | gei2 do1 wai2 | 几位？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 兩位，唔該。 | loeng5 wai2 m4 goi1 | 两位，劳驾。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 堂食定外賣？ | tong4 sik6 ding6 ngoi6 maai6 | 堂食还是外带？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 堂食，唔該。 | tong4 sik6 m4 goi1 | 堂食，劳驾。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 我想要呢個，仲有一杯凍檸茶。 | ngo5 soeng2 jiu3 ni1 go3 zung6 jau5 jat1 bui1 dung3 ning4 caa4 | 我要这个，还有一杯冰柠檬茶。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 杯嘢飲要唔要少冰？ | bui1 je5 jam2 jiu3 m4 jiu3 siu2 bing1 | 饮品要不要少冰？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 少冰就得，唔該。 | siu2 bing1 zau6 dak1 m4 goi1 | 少冰就可以，谢谢。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 好，仲要唔要其他嘢？ | hou2 zung6 jiu3 m4 jiu3 kei4 taa1 je5 | 好，还要别的吗？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該，我想加多一份。 | m4 goi1 ngo5 soeng2 gaa1 do1 jat1 fan6 | 劳驾，我想再加一份。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 呢個辣唔辣？ | ni1 go3 laat6 m4 laat6 | 这个辣不辣？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 有少少辣。 | jau5 siu2 siu2 laat6 | 有一点辣。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 可唔可以唔要辣？ | ho2 m4 ho2 ji5 m4 jiu3 laat6 | 可以不要辣吗？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 我幫你問下廚房。 | ngo5 bong1 nei5 man6 haa5 coeng4 fong2 | 我帮你问一下厨房。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 唔該，埋單。 | m4 goi1 maai4 daan1 | 劳驾，结账。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 好，請等一陣。 | hou2 cing2 dang2 jat1 zan6 | 好，请稍等。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 可唔可以用八達通？ | ho2 m4 ho2 ji5 jung6 baat3 daat6 tung1 | 可以用八达通吗？ | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 我睇下呢度收唔收。 | ngo5 tai2 haa5 ni1 dou6 sau1 m4 sau1 | 我看一下这里收不收。 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 对比项

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 少甜／走甜 | siu2 tim4 / zau2 tim4 | 减少甜度／不加甜味 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |
| 少冰／走冰 | siu2 bing1 / zau2 bing1 | 少放冰／不放冰 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 跟读材料

| 粤语 | 粤拼候选 | 普通话释义 | 状态 | 来源 |
| --- | --- | --- | --- | --- |
| 唔該，埋單。 | m4 goi1 maai4 daan1 | 练习结账请求 | CONTENT_REVIEW_REQUIRED | Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review. |

#### 题目

- **cantonese.v6.question.lesson-07.seating**（SINGLE_SELECT）
  - 题干：店员问「幾多位？」，两个人应怎样回答？
  - 选项：a. 兩位，唔該。；b. 堂食，唔該。；c. 外賣，唔該。；d. 我想要呢個。
  - 当前答案：兩位，唔該。
  - 当前解释：先回答人数；堂食或外卖是下一步要确认的用餐方式。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.dine-or-take**（SINGLE_SELECT）
  - 题干：想在店里吃，店员问「堂食定外賣？」时应选？
  - 选项：a. 堂食；b. 外賣；c. 走冰；d. 埋單
  - 当前答案：堂食
  - 当前解释：堂食是店内用餐。
  - 审核问题：解释偏浅；建议：「堂食」对应在店内用餐；「外賣」对应外带/外送语境。实际用法及地域习惯仍需确认。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.takeaway**（MULTI_SELECT）
  - 题干：哪些词语可用于表达外带／拿走相关意思？（多选）
  - 选项：a. 外賣；b. 堂食；c. 拎走；d. 埋單
  - 当前答案：外賣；拎走
  - 当前解释：两者都与外带场景有关，但句法位置与实际用法仍要结合语境；课程保留为审核候选。
  - 审核问题：「外賣」表示外带情境/餐食，「拎走」是动作表达；题目把不同句法角色概括成同一“词语意思”。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.point-menu**（SINGLE_SELECT）
  - 题干：指着菜单想要其中一项，哪句是在点选菜品？
  - 选项：a. 我想要呢個。；b. 呢個辣唔辣？；c. 呢個可唔可以唔要辣？；d. 呢個幾時上？
  - 当前答案：我想要呢個。
  - 当前解释：其他句子围绕同一菜品提问，但只有第一句明确点选。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.ice-difference**（SINGLE_SELECT）
  - 题干：想完全不加冰，应说什么？
  - 选项：a. 走冰；b. 少冰；c. 少甜；d. 堂食
  - 当前答案：走冰
  - 当前解释：「走冰」与「少冰」不同。
  - 审核问题：解释偏浅；建议：本课把「少冰」作为减少冰量、「走冰」作为不加冰的对比；请人工核对餐饮场景中的实际用法。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.sweetness**（SINGLE_SELECT）
  - 题干：想表达甜度减少而不是完全不加甜味，哪一个更符合本课的对比？
  - 选项：a. 少甜；b. 走甜；c. 少冰；d. 走冰
  - 当前答案：少甜
  - 当前解释：候选课程以「少甜／走甜」区分减少甜度与不加甜味；实际点单用法需人工确认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.spice-question**（SINGLE_SELECT）
  - 题干：点餐前想确认辣度，选哪句？
  - 选项：a. 呢個辣唔辣？；b. 可唔可以用八達通？；c. 堂食定外賣？；d. 幾多位？
  - 当前答案：呢個辣唔辣？
  - 当前解释：先询问是否辣。
  - 审核问题：解释偏浅；建议：「呢個辣唔辣？」是在询问这道食物是否辣，不代表店员已确认配料或能否调整。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.spice-adjust**（SINGLE_SELECT）
  - 题干：店员说有点辣，你希望不辣，下一句较合适？
  - 选项：a. 可唔可以唔要辣？；b. 唔該埋單。；c. 少冰就得。；d. 可唔可以轉凍飲？
  - 当前答案：可唔可以唔要辣？
  - 当前解释：礼貌询问能否调整辣度；其他选项是在结账或调整饮品。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.bill**（SINGLE_SELECT）
  - 题干：吃完准备付款时，应选哪句？
  - 选项：a. 唔該，埋單。；b. 可唔可以用八達通？；c. 仲要唔要其他嘢？；d. 堂食，唔該。
  - 当前答案：唔該，埋單。
  - 当前解释：先提出结账，再核对支付方式；其余分别是支付询问、加单确认和用餐方式。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.pay-method**（SINGLE_SELECT）
  - 题干：不确定餐厅能否用八达通付款，怎样确认？
  - 选项：a. 可唔可以用八達通？；b. 一定要收八達通。；c. 呢個辣唔辣？；d. 一杯凍檸茶。
  - 当前答案：可唔可以用八達通？
  - 当前解释：支付方式要先问，不能默认。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.order-flow**（MULTI_SELECT）
  - 题干：点餐前或点餐时应确认哪些信息？（多选）
  - 选项：a. 人数与用餐方式；b. 菜品与数量；c. 饮品冰量或口味；d. 现实中的站牌
  - 当前答案：人数与用餐方式；菜品与数量；饮品冰量或口味
  - 当前解释：餐厅情景需确认人数、菜品和口味。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.payment-multi**（MULTI_SELECT）
  - 题干：哪些属于合理的结账行为？（多选）
  - 选项：a. 说「唔該，埋單」；b. 先询问是否支持八达通；c. 假定任何店都支持同种支付方式；d. 等店员确认
  - 当前答案：说「唔該，埋單」；先询问是否支持八达通；等店员确认
  - 当前解释：先提出结账、核对支付方式并等待确认。
  - 审核问题：多选项同时混合粤语表达、支付方式事实和服务流程，未明确考查词句还是行为规范。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.ice-false**（TRUE_FALSE）
  - 题干：「少冰」和「走冰」都表示完全不放冰。
  - 选项：a. 正确；b. 错误
  - 当前答案：错误
  - 当前解释：少冰是少放，走冰是不放。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.spice-true**（TRUE_FALSE）
  - 题干：菜品能否改成不辣，应先问店员确认。
  - 选项：a. 正确；b. 错误
  - 当前答案：正确
  - 当前解释：能否调整由餐厅决定。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED
- **cantonese.v6.question.lesson-07.listen-dine-in**（LISTENING）
  - 题干：听标准音，顾客选了哪种用餐方式？
  - 选项：a. 堂食；b. 外賣；c. 没有说明；d. 打包后留在店内
  - 当前答案：堂食
  - 当前解释：听顾客回答「堂食，唔該」。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-07.listen-ice**（LISTENING）
  - 题干：听标准音，顾客选择了什么冰量？
  - 选项：a. 少冰；b. 走冰；c. 加冰；d. 未提冰量
  - 当前答案：少冰
  - 当前解释：听「少冰就得，唔該」。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-07.listen-spicy**（LISTENING）
  - 题干：听标准音，店员如何描述辣度？
  - 选项：a. 有少少辣；b. 完全唔辣；c. 非常辣；d. 没有回答
  - 当前答案：有少少辣
  - 当前解释：听原句，不推断其他餐厅的菜品。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；BLOCKED_BY_AUDIO
- **cantonese.v6.question.lesson-07.speak-order**（SPEAKING）
  - 题干：情景：指着菜单点一个菜。听标准音、录音并 A/B 回听。
  - 选项：无（口语练习不评分）
  - 当前答案：无（不评分）
  - 当前解释：本地录音自主对比，不上传、不评分。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；UNSCORED_NON_GRADEABLE
- **cantonese.v6.question.lesson-07.speak-bill**（SPEAKING）
  - 题干：情景：吃完想结账。听标准音、录音并 A/B 回听。
  - 选项：无（口语练习不评分）
  - 当前答案：无（不评分）
  - 当前解释：练习礼貌结账请求。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED；UNSCORED_NON_GRADEABLE
- **cantonese.v6.question.lesson-07.challenge-sequence**（SINGLE_SELECT）
  - 题干：情景挑战：进餐厅后，哪组顺序最合理？
  - 选项：a. 说人数与堂食／外賣 → 点餐与口味 → 埋單；b. 埋單 → 再说人数 → 问路；c. 先问路 → 点餐 → 再进店；d. 先说走冰 → 离开 → 再看菜单
  - 当前答案：说人数与堂食／外賣 → 点餐与口味 → 埋單
  - 当前解释：这是本课从入店到付款的流程。
  - 审核问题：常规语言、读音与题意审核。
  - 状态：CONTENT_REVIEW_REQUIRED

#### 音频

需要 37 个音频槽位；当前全部待文本及粤拼审核，未生成音频。

## Mobile 迁移与去重

Mobile lesson-05-review 决定作为 **UNIT_REVIEW**：复用 Lesson 01–04 的题目，不创建或覆盖 Server lesson-05。

### 内容 ID 映射

| OLD_MOBILE_ID | NEW_SERVER_ID | 重叠分类 | 已存在的 Server ID | 建议 |
| --- | --- | --- | --- | --- |
| greeting_hello | cantonese.v6.content.lesson-01.hello | DUPLICATE | cantonese.v6.content.lesson-05.hello | MERGE |
| greeting_morning | cantonese.v6.content.lesson-01.morning | DUPLICATE | cantonese.v6.content.lesson-05.morning | MERGE |
| greeting_bye | cantonese.v6.content.lesson-01.bye | PARTIAL_OVERLAP | cantonese.v6.content.lesson-05.d3d, cantonese.v6.content.lesson-05.bye | KEEP |
| pronoun_i | cantonese.v6.content.lesson-02.i | UNIQUE | — | KEEP |
| pronoun_you | cantonese.v6.content.lesson-02.you | UNIQUE | — | KEEP |
| pronoun_he | cantonese.v6.content.lesson-02.he | UNIQUE | — | KEEP |
| pronoun_you_plural | cantonese.v6.content.lesson-02.you-plural | UNIQUE | — | KEEP |
| phrase_my_name | cantonese.v6.content.lesson-03.my-name | UNIQUE | — | KEEP |
| phrase_ask_name | cantonese.v6.content.lesson-03.ask-name | UNIQUE | — | KEEP |
| word_what | cantonese.v6.content.lesson-03.what | UNIQUE | — | KEEP |
| word_name | cantonese.v6.content.lesson-03.name | UNIQUE | — | KEEP |
| phrase_you-then | cantonese.v6.content.lesson-03.you-then | UNIQUE | — | KEEP |
| grammar_is | cantonese.v6.content.lesson-04.is | UNIQUE | — | KEEP |
| grammar_is_not | cantonese.v6.content.lesson-04.is-not | UNIQUE | — | KEEP |
| grammar_is_question | cantonese.v6.content.lesson-04.is-question | UNIQUE | — | KEEP |
| phrase_is_xiaoming | cantonese.v6.content.lesson-04.ask-xiaoming | UNIQUE | — | KEEP |
| phrase_not_xiaoming | cantonese.v6.content.lesson-04.not-xiaoming | UNIQUE | — | KEEP |
| phrase_i_am_xiaoming | cantonese.v6.content.lesson-04.i-am-xiaoming | UNIQUE | — | KEEP |

DUPLICATE 项建议将首次教学集中在 Lesson 01；Lesson 05 对话作为情境复现保留。所有既有 Server ID 暂留，等待审核决定。拜拜仅与 Lesson 05 的告别对话部分重叠。

### Mobile 音频 ID 映射

| OLD_MOBILE_AUDIO_ID | NEW_SERVER_AUDIO_ID | CONTENT_ID | STATUS |
| --- | --- | --- | --- |
| life.greeting.hello | cantonese.v6.audio.lesson-01.hello | cantonese.v6.content.lesson-01.hello | CONTENT_REVIEW_REQUIRED |
| life.greeting.morning | cantonese.v6.audio.lesson-01.morning | cantonese.v6.content.lesson-01.morning | CONTENT_REVIEW_REQUIRED |
| life.greeting.bye | cantonese.v6.audio.lesson-01.bye | cantonese.v6.content.lesson-01.bye | CONTENT_REVIEW_REQUIRED |
| life.pronoun.i | cantonese.v6.audio.lesson-02.i | cantonese.v6.content.lesson-02.i | CONTENT_REVIEW_REQUIRED |
| life.pronoun.you | cantonese.v6.audio.lesson-02.you | cantonese.v6.content.lesson-02.you | CONTENT_REVIEW_REQUIRED |
| life.pronoun.he | cantonese.v6.audio.lesson-02.he | cantonese.v6.content.lesson-02.he | CONTENT_REVIEW_REQUIRED |
| life.pronoun.you-plural | cantonese.v6.audio.lesson-02.you-plural | cantonese.v6.content.lesson-02.you-plural | CONTENT_REVIEW_REQUIRED |
| life.introduction.my-name | cantonese.v6.audio.lesson-03.my-name | cantonese.v6.content.lesson-03.my-name | CONTENT_REVIEW_REQUIRED |
| life.introduction.ask-name | cantonese.v6.audio.lesson-03.ask-name | cantonese.v6.content.lesson-03.ask-name | CONTENT_REVIEW_REQUIRED |
| life.introduction.what | cantonese.v6.audio.lesson-03.what | cantonese.v6.content.lesson-03.what | CONTENT_REVIEW_REQUIRED |
| life.introduction.name | cantonese.v6.audio.lesson-03.name | cantonese.v6.content.lesson-03.name | CONTENT_REVIEW_REQUIRED |
| life.introduction.you-then | cantonese.v6.audio.lesson-03.you-then | cantonese.v6.content.lesson-03.you-then | CONTENT_REVIEW_REQUIRED |
| life.confirmation.is | cantonese.v6.audio.lesson-04.is | cantonese.v6.content.lesson-04.is | CONTENT_REVIEW_REQUIRED |
| life.confirmation.is-not | cantonese.v6.audio.lesson-04.is-not | cantonese.v6.content.lesson-04.is-not | CONTENT_REVIEW_REQUIRED |
| life.confirmation.is-question | cantonese.v6.audio.lesson-04.is-question | cantonese.v6.content.lesson-04.is-question | CONTENT_REVIEW_REQUIRED |
| life.confirmation.ask-xiaoming | cantonese.v6.audio.lesson-04.ask-xiaoming | cantonese.v6.content.lesson-04.ask-xiaoming | CONTENT_REVIEW_REQUIRED |
| life.confirmation.not-xiaoming | cantonese.v6.audio.lesson-04.not-xiaoming | cantonese.v6.content.lesson-04.not-xiaoming | CONTENT_REVIEW_REQUIRED |
| life.confirmation.i-am-xiaoming | cantonese.v6.audio.lesson-04.i-am-xiaoming | cantonese.v6.content.lesson-04.i-am-xiaoming | CONTENT_REVIEW_REQUIRED |

### 36 个 Mobile Exercise 映射

| OLD_MOBILE_EXERCISE_ID | CONTENT_IDS | QUESTION_IDS | MAPPING |
| --- | --- | --- | --- |
| l1-intro-hello | cantonese.v6.content.lesson-01.hello | — | INTRO_CONTENT |
| l1-intro-morning | cantonese.v6.content.lesson-01.morning | — | INTRO_CONTENT |
| l1-choice-morning | — | cantonese.v6.question.lesson-01.morning-meaning | QUESTION_SET |
| l1-match-greetings | — | cantonese.v6.question.lesson-01.match-hello-jyutping, cantonese.v6.question.lesson-01.match-morning-jyutping, cantonese.v6.question.lesson-01.match-bye-jyutping | QUESTION_SET |
| l1-order-hello | — | cantonese.v6.question.lesson-01.order-hello | QUESTION_SET |
| l1-intro-bye | cantonese.v6.content.lesson-01.bye | — | INTRO_CONTENT |
| l1-choice-greeting | — | cantonese.v6.question.lesson-01.greeting-situation | QUESTION_SET |
| l2-intro-i | cantonese.v6.content.lesson-02.i | — | INTRO_CONTENT |
| l2-intro-you | cantonese.v6.content.lesson-02.you | — | INTRO_CONTENT |
| l2-intro-he | cantonese.v6.content.lesson-02.he | — | INTRO_CONTENT |
| l2-choice-he | — | cantonese.v6.question.lesson-02.pronoun-he | QUESTION_SET |
| l2-match-pronouns | — | cantonese.v6.question.lesson-02.match-i-jyutping, cantonese.v6.question.lesson-02.match-you-jyutping, cantonese.v6.question.lesson-02.match-he-jyutping | QUESTION_SET |
| l2-intro-you-plural | cantonese.v6.content.lesson-02.you-plural | — | INTRO_CONTENT |
| l2-choice-you-plural | — | cantonese.v6.question.lesson-02.you-plural-meaning | QUESTION_SET |
| l3-intro-name | cantonese.v6.content.lesson-03.my-name | — | INTRO_CONTENT |
| l3-intro-ask-name | cantonese.v6.content.lesson-03.ask-name | — | INTRO_CONTENT |
| l3-choice-ask-name | — | cantonese.v6.question.lesson-03.ask-name-meaning | QUESTION_SET |
| l3-match-words | — | cantonese.v6.question.lesson-03.what-meaning, cantonese.v6.question.lesson-03.name-meaning | QUESTION_SET |
| l3-order-name | — | cantonese.v6.question.lesson-03.order-my-name | QUESTION_SET |
| l3-choice-response | — | cantonese.v6.question.lesson-03.answer-introduction | QUESTION_SET |
| l3-intro-you-then | cantonese.v6.content.lesson-03.you-then | — | INTRO_CONTENT |
| l4-intro-is | cantonese.v6.content.lesson-04.is | — | INTRO_CONTENT |
| l4-intro-not | cantonese.v6.content.lesson-04.is-not | — | INTRO_CONTENT |
| l4-intro-is-question | cantonese.v6.content.lesson-04.is-question | — | INTRO_CONTENT |
| l4-choice-not | — | cantonese.v6.question.lesson-04.not-meaning | QUESTION_SET |
| l4-match-forms | — | cantonese.v6.question.lesson-04.match-is-meaning, cantonese.v6.question.lesson-04.match-is-not-meaning, cantonese.v6.question.lesson-04.match-is-question-meaning | QUESTION_SET |
| l4-order-sentence | — | cantonese.v6.question.lesson-04.order-negative | QUESTION_SET |
| l4-choice-question | — | cantonese.v6.question.lesson-04.affirmative-answer | QUESTION_SET |
| l5-choice-morning | — | cantonese.v6.question.lesson-01.morning-meaning | UNIT_REVIEW_REUSE |
| l5-match-greetings | — | cantonese.v6.question.lesson-01.match-hello-jyutping, cantonese.v6.question.lesson-01.match-morning-jyutping, cantonese.v6.question.lesson-01.match-bye-jyutping | UNIT_REVIEW_REUSE |
| l5-order-hello | — | cantonese.v6.question.lesson-01.order-hello | UNIT_REVIEW_REUSE |
| l5-choice-pronoun | — | cantonese.v6.question.lesson-02.pronoun-he | UNIT_REVIEW_REUSE |
| l5-match-pronouns | — | cantonese.v6.question.lesson-02.match-i-jyutping, cantonese.v6.question.lesson-02.match-you-jyutping, cantonese.v6.question.lesson-02.match-he-jyutping | UNIT_REVIEW_REUSE |
| l5-order-name | — | cantonese.v6.question.lesson-03.order-my-name | UNIT_REVIEW_REUSE |
| l5-choice-is-question | — | cantonese.v6.question.lesson-04.match-is-question-meaning | UNIT_REVIEW_REUSE |
| l5-choice-answer | — | cantonese.v6.question.lesson-04.affirmative-answer | UNIT_REVIEW_REUSE |

MATCH 以逐项粤拼 / 释义选择题表达；ORDER 以现有 SINGLE_SELECT 题型表达。Lesson 05 Review 复用已有问题，不增加重复内容。

## Jyutping 审核

- 旧 Server 缺失项：80 条，均已写入候选字段并标记 HUMAN_REVIEW_REQUIRED。
- 旧 Server 已存在但未审核的粤拼：18 条；保留原值，不代表已确认。
- 新迁入 Mobile 01–04 的 18 个知识项已有本地粤拼，但仍是未审核候选。
- Foundation 9 个声调粤拼和 1 个整句粤拼均待审核。
- 候选按粤语文本逐项填写，不从普通话释义或英文生成；不能视作已审核读音。

| ITEM_ID | LESSON | 粤语文本 | JYUTPING_CANDIDATE | CONFIDENCE | STATUS |
| --- | --- | --- | --- | --- | --- |
| cantonese.v6.content.lesson-05.thanks-contrast | lesson-05 | 唔該／多謝 | m4 goi1 / do1 ze6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.how-lately | lesson-05 | 近排點呀？ | gan6 paai4 dim2 aa3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.im-good | lesson-05 | 我幾好，你呢？ | ngo5 gei2 hou2 nei5 ne1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.excuse-question | lesson-05 | 唔該，想問你一樣嘢。 | m4 goi1 soeng2 man6 nei5 jat1 joeng6 je5 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.gift-thanks | lesson-05 | 多謝你送畀我。 | do1 ze6 nei5 sung3 bei2 ngo5 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.bye | lesson-05 | 我走先喇，下次見。 | ngo5 zau2 sin1 laa3 haa6 ci3 gin3 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d1a | lesson-05 | 早晨！好耐冇見。 | zou2 san4 hou2 noi6 mou5 gin3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d1b | lesson-05 | 係呀，近排點呀？ | hai6 aa3 gan6 paai4 dim2 aa3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d1c | lesson-05 | 我幾好，你呢？ | ngo5 gei2 hou2 nei5 ne1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d1d | lesson-05 | 我都幾好。得閒再傾！ | ngo5 dou1 gei2 hou2 dak1 haan4 zoi3 king1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d2a | lesson-05 | 唔該，可唔可以幫我開門？ | m4 goi1 ho2 m4 ho2 ji5 bong1 ngo5 hoi1 mun4 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d2b | lesson-05 | 得，冇問題。 | dak1 mou5 man6 tai4 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d2d | lesson-05 | 唔使客氣。 | m4 sai2 haak3 hei3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d3a | lesson-05 | 對唔住，我冇留意。 | deoi3 m4 zyu6 ngo5 mou5 lau4 ji3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d3b | lesson-05 | 唔緊要，你冇事吖嘛？ | m4 gan2 jiu3 nei5 mou5 si6 aa3 maa3 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d3c | lesson-05 | 冇事，多謝你。 | mou5 si6 do1 ze6 nei5 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d3d | lesson-05 | 咁就好，拜拜。 | gam2 zau6 hou2 baai1 baai3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.self-compare | lesson-05 | 唔該，可唔可以幫我開門？ | m4 goi1 ho2 m4 ho2 ji5 bong1 ngo5 hoi1 mun4 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.straight | lesson-06 | 一直行 | jat1 zik6 haang4 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.left | lesson-06 | 轉左 | zyun2 zo2 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.right | lesson-06 | 轉右 | zyun2 jau6 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.cross | lesson-06 | 過馬路 | gwo3 maa5 lou6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.next-stop | lesson-06 | 下一站 | haa6 jat1 zaam6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.where-station | lesson-06 | 唔好意思，地鐵站喺邊度？ | m4 hou2 ji3 si3 dei6 tit3 zaam6 hai2 bin1 dou6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.how-go | lesson-06 | 請問點樣去地鐵站？ | cing2 man6 dim2 joeng2 heoi3 dei6 tit3 zaam6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.how-long | lesson-06 | 行過去要幾耐？ | haang4 gwo3 heoi3 jiu3 gei2 noi6 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.bus-go | lesson-06 | 呢架車去唔去旺角？ | ni1 gaa3 ce1 heoi3 m4 heoi3 wong6 gok3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.please-repeat | lesson-06 | 唔該，可唔可以講多次？ | m4 goi1 ho2 m4 ho2 ji5 gong2 do1 ci3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.direction-contrast | lesson-06 | 喺邊度？／點樣去？ | hai2 bin1 dou6 / dim2 joeng2 heoi3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.junction-phrase | lesson-06 | 前面個路口 | cin4 min6 go3 lou6 hau2 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d1a | lesson-06 | 唔好意思，地鐵站喺邊度？ | m4 hou2 ji3 si3 dei6 tit3 zaam6 hai2 bin1 dou6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d1b | lesson-06 | 一直行，前面個路口轉左。 | jat1 zik6 haang4 cin4 min6 go3 lou6 hau2 zyun2 zo2 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d1c | lesson-06 | 係咪過咗馬路就到？ | hai6 m4 hai6 gwo3 zo2 maa5 lou6 zau6 dou3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d1d | lesson-06 | 係，過咗馬路就見到。 | hai6 gwo3 zo2 maa5 lou6 zau6 gin3 dou3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d1e | lesson-06 | 唔該晒！ | m4 goi1 saai3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d2a | lesson-06 | 行過去要幾耐？ | haang4 gwo3 heoi3 jiu3 gei2 noi6 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d2b | lesson-06 | 大概十分鐘。 | daai6 koi3 sap6 fan1 zung1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d2c | lesson-06 | 一直行，定係要轉彎？ | jat1 zik6 haang4 ding6 hai6 jiu3 zyun2 waan4 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d2d | lesson-06 | 行到個路口轉右。 | haang4 dou3 go3 lou6 hau2 zyun2 jau6 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d3a | lesson-06 | 唔該，呢架車去唔去旺角？ | m4 goi1 ni1 gaa3 ce1 heoi3 m4 heoi3 wong6 gok3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d3b | lesson-06 | 去，你可以上車。 | heoi3 nei5 ho2 ji5 soeng5 ce1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d3c | lesson-06 | 請問喺邊個站落車？ | cing2 man6 hai2 bin1 go3 zaam6 lok6 ce1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d3d | lesson-06 | 我唔肯定，你睇下車上面嘅站牌。 | ngo5 m4 ding6 nei5 tai2 haa5 ce1 soeng6 min6 ge3 zaam6 paai4 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d4a | lesson-06 | 唔該，可唔可以講多次？ | m4 goi1 ho2 m4 ho2 ji5 gong2 do1 ci3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d4b | lesson-06 | 一直行，第二個路口轉左。 | jat1 zik6 haang4 dai6 ji6 go3 lou6 hau2 zyun2 zo2 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d4c | lesson-06 | 第二個路口轉左，係咪？ | dai6 ji6 go3 lou6 hau2 zyun2 zo2 hai6 m4 hai6 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.d4d | lesson-06 | 係，行多陣就到。 | hai6 haang4 do1 zan6 zau6 dou3 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.dine-in | lesson-07 | 堂食 | tong4 sik6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.takeaway | lesson-07 | 外賣 | ngoi6 maai6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.take-away-action | lesson-07 | 拎走 | ling1 zau2 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.order | lesson-07 | 落單 | lok6 daan1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.less-ice | lesson-07 | 少冰 | siu2 bing1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.less-sweet | lesson-07 | 少甜 | siu2 tim4 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.no-sweet | lesson-07 | 走甜 | zau2 tim4 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.sweetness-contrast | lesson-07 | 少甜／走甜 | siu2 tim4 / zau2 tim4 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.not-spicy | lesson-07 | 唔要辣 | m4 jiu3 laat6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.two-people | lesson-07 | 兩位，唔該。 | loeng5 wai2 m4 goi1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.want-this | lesson-07 | 我想要呢個。 | ngo5 soeng2 jiu3 ni1 go3 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.order-drink | lesson-07 | 一杯凍檸茶，少冰，唔該。 | jat1 bui1 dung3 ning4 caa4 siu2 bing1 m4 goi1 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.spicy-check | lesson-07 | 呢個辣唔辣？ | ni1 go3 laat6 m4 laat6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.bill-please | lesson-07 | 唔該，埋單。 | m4 goi1 maai4 daan1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.ice-contrast | lesson-07 | 少冰／走冰 | siu2 bing1 / zau2 bing1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d1a | lesson-07 | 幾多位？ | gei2 do1 wai2 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d1b | lesson-07 | 兩位，唔該。 | loeng5 wai2 m4 goi1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d1c | lesson-07 | 堂食定外賣？ | tong4 sik6 ding6 ngoi6 maai6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d1d | lesson-07 | 堂食，唔該。 | tong4 sik6 m4 goi1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d2a | lesson-07 | 我想要呢個，仲有一杯凍檸茶。 | ngo5 soeng2 jiu3 ni1 go3 zung6 jau5 jat1 bui1 dung3 ning4 caa4 | LOW | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d2b | lesson-07 | 杯嘢飲要唔要少冰？ | bui1 je5 jam2 jiu3 m4 jiu3 siu2 bing1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d2c | lesson-07 | 少冰就得，唔該。 | siu2 bing1 zau6 dak1 m4 goi1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d2d | lesson-07 | 好，仲要唔要其他嘢？ | hou2 zung6 jiu3 m4 jiu3 kei4 taa1 je5 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d2e | lesson-07 | 唔該，我想加多一份。 | m4 goi1 ngo5 soeng2 gaa1 do1 jat1 fan6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d3a | lesson-07 | 呢個辣唔辣？ | ni1 go3 laat6 m4 laat6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d3b | lesson-07 | 有少少辣。 | jau5 siu2 siu2 laat6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d3c | lesson-07 | 可唔可以唔要辣？ | ho2 m4 ho2 ji5 m4 jiu3 laat6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d3d | lesson-07 | 我幫你問下廚房。 | ngo5 bong1 nei5 man6 haa5 coeng4 fong2 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d4a | lesson-07 | 唔該，埋單。 | m4 goi1 maai4 daan1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d4b | lesson-07 | 好，請等一陣。 | hou2 cing2 dang2 jat1 zan6 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d4c | lesson-07 | 可唔可以用八達通？ | ho2 m4 ho2 ji5 jung6 baat3 daat6 tung1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.d4d | lesson-07 | 我睇下呢度收唔收。 | ngo5 tai2 haa5 ni1 dou6 sau1 m4 sau1 | MEDIUM | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.self-compare | lesson-07 | 唔該，埋單。 | m4 goi1 maai4 daan1 | MEDIUM | HUMAN_REVIEW_REQUIRED |

### 全部 18 条已有粤拼（仍未审核）

| ITEM_ID | LESSON | TEXT | CURRENT_JYUTPING | STATUS |
| --- | --- | --- | --- | --- |
| cantonese.v6.content.lesson-05.morning | lesson-05 | 早晨 | zou2 san4 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.hello | lesson-05 | 你好 | nei5 hou2 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.long-time | lesson-05 | 好耐冇見 | hou2 noi6 mou5 gin3 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.please | lesson-05 | 唔該 | m4 goi1 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.thanks | lesson-05 | 多謝 | do1 ze6 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.youre-welcome | lesson-05 | 唔使客氣 | m4 sai2 haak3 hei3 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.sorry | lesson-05 | 對唔住 | deoi3 m4 zyu6 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.no-matter | lesson-05 | 唔緊要 | m4 gan2 jiu3 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.see-you | lesson-05 | 下次見 | haa6 ci3 gin3 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.thanks-phrase | lesson-05 | 唔該晒 | m4 goi1 saai3 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-05.d2c | lesson-05 | 唔該晒！ | m4 goi1 saai3 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.station | lesson-06 | 地鐵站 | dei6 tit3 zaam6 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.where | lesson-06 | 邊度 | bin1 dou6 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-06.how | lesson-06 | 點樣 | dim2 joeng2 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.bill | lesson-07 | 埋單 | maai4 daan1 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.no-ice | lesson-07 | 走冰 | zau2 bing1 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.iced-lemon-tea | lesson-07 | 凍檸茶 | dung3 ning2 caa4 | JYUTPING_REVIEW_REQUIRED |
| cantonese.v6.content.lesson-07.less-ice-phrase | lesson-07 | 少冰，唔該 | siu2 bing1 m4 goi1 | JYUTPING_REVIEW_REQUIRED |

## 4 个答案审核项

| QUESTION_ID | LESSON | PROMPT | OPTIONS | CURRENT_ANSWER | WHY_AMBIGUOUS | RECOMMENDED_FIX |
| --- | --- | --- | --- | --- | --- | --- |
| cantonese.v6.question.lesson-05.thanks-multi | lesson-05 | 哪些情境适合用本课的「唔該」或「多謝」？（多选） | 别人帮忙开门后说「唔該」 / 收到礼物后说「多謝」 / 碰撞别人后说「下次見」 / 问路前用「唔該」礼貌开场 | 别人帮忙开门后说「唔該」 / 收到礼物后说「多謝」 / 问路前用「唔該」礼貌开场 | 题干把「感谢」和「唔該」作礼貌开场混在同一判断里；第三项并非感谢，当前选项却同时问“适合用”两种表达，学习目标不够单一。 | 拆成“表达感谢”和“礼貌开场”两题，或明确题干按功能分类；人工确认后再设答案。 |
| cantonese.v6.question.lesson-06.unknown-route | lesson-06 | 如果你不确定车是否到某站，哪种回应较安全？ | 坦白不确定，并请对方看站牌 / 估计是同一条线，叫对方先上车再看 / 凭上次乘车印象回答，不再核对 / 说「应该会到」，但不确认站名 | 坦白不确定，并请对方看站牌 | 考查现实出行安全常识，选项没有呈现对应粤语说法；它不能证明学习者掌握了本课粤语。 | 改为辨认或选择一条经过审核的粤语确认句，或将安全提示移出计分题；当前答案不自动改动。 |
| cantonese.v6.question.lesson-07.takeaway | lesson-07 | 哪些词语可用于表达外带／拿走相关意思？（多选） | 外賣 / 堂食 / 拎走 / 埋單 | 外賣 / 拎走 | 「外賣」表示外带情境/餐食，「拎走」是动作表达；题目把不同句法角色概括成同一“词语意思”。 | 拆分为“堂食/外賣”场景选择和含「拎走」的完整句理解题；先由粤语审核员确认自然语境。 |
| cantonese.v6.question.lesson-07.payment-multi | lesson-07 | 哪些属于合理的结账行为？（多选） | 说「唔該，埋單」 / 先询问是否支持八达通 / 假定任何店都支持同种支付方式 / 等店员确认 | 说「唔該，埋單」 / 先询问是否支持八达通 / 等店员确认 | 多选项同时混合粤语表达、支付方式事实和服务流程，未明确考查词句还是行为规范。 | 保留语言学习目标，改为辨认「埋單」或询问支付方式的表达；把等待店员确认留作非计分提示。 |

当前答案保留原样，没有自动修正。

## 7 个解释偏浅项

| QUESTION_ID | CURRENT_EXPLANATION | SUGGESTED_EXPLANATION | STATUS |
| --- | --- | --- | --- |
| cantonese.v6.question.lesson-05.review-true | 本课帮助对话即这样使用。 | 「唔使客氣」在本课对话里回应对方的道谢；请人工确认该场景中的语气、文字和读音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.question.lesson-06.left | 左、右不可混淆。 | 在本题的路线语境里，「轉左」表示向左转；「轉」的方向义粤拼候选仍待确认。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.question.lesson-06.right | 「轉右」表示右转。 | 在本题的路线语境里，「轉右」表示向右转；请结合路口场景核对表达与读音。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.question.lesson-06.where-true | 这是地点问句。 | 「喺」在此标示地点，「邊度」询问位置；组合后可用于询问某处在哪里。语法讲解待粤语审核。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.question.lesson-07.dine-or-take | 堂食是店内用餐。 | 「堂食」对应在店内用餐；「外賣」对应外带/外送语境。实际用法及地域习惯仍需确认。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.question.lesson-07.ice-difference | 「走冰」与「少冰」不同。 | 本课把「少冰」作为减少冰量、「走冰」作为不加冰的对比；请人工核对餐饮场景中的实际用法。 | HUMAN_REVIEW_REQUIRED |
| cantonese.v6.question.lesson-07.spice-question | 先询问是否辣。 | 「呢個辣唔辣？」是在询问这道食物是否辣，不代表店员已确认配料或能否调整。 | HUMAN_REVIEW_REQUIRED |

## Audio Manifest

总槽位：126；真实音频：0；待文本审核：126；待粤拼审核：126。所有 Listening 题均 BLOCKED_BY_AUDIO。

| audioId | lessonId | contentId | text | jyutping | type | voiceRequirement | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cantonese.v6.audio.lesson-01.hello | lesson-01 | cantonese.v6.content.lesson-01.hello | 你好 | nei5 hou2 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-01.morning | lesson-01 | cantonese.v6.content.lesson-01.morning | 早晨 | zou2 san4 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-01.bye | lesson-01 | cantonese.v6.content.lesson-01.bye | 拜拜 | baai1 baai3 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-02.i | lesson-02 | cantonese.v6.content.lesson-02.i | 我 | ngo5 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-02.you | lesson-02 | cantonese.v6.content.lesson-02.you | 你 | nei5 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-02.he | lesson-02 | cantonese.v6.content.lesson-02.he | 佢 | keoi5 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-02.you-plural | lesson-02 | cantonese.v6.content.lesson-02.you-plural | 你哋 | nei5 dei6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-03.my-name | lesson-03 | cantonese.v6.content.lesson-03.my-name | 我叫小明。 | ngo5 giu3 siu2 ming4 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-03.ask-name | lesson-03 | cantonese.v6.content.lesson-03.ask-name | 你叫咩名呀？ | nei5 giu3 me1 meng2 aa3 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-03.what | lesson-03 | cantonese.v6.content.lesson-03.what | 咩 | me1 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-03.name | lesson-03 | cantonese.v6.content.lesson-03.name | 名 | meng2 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-03.you-then | lesson-03 | cantonese.v6.content.lesson-03.you-then | 你呢？ | nei5 ne1 | PHRASE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-04.is | lesson-04 | cantonese.v6.content.lesson-04.is | 係 | hai6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-04.is-not | lesson-04 | cantonese.v6.content.lesson-04.is-not | 唔係 | m4 hai6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-04.is-question | lesson-04 | cantonese.v6.content.lesson-04.is-question | 係咪 | hai6 mai6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-04.ask-xiaoming | lesson-04 | cantonese.v6.content.lesson-04.ask-xiaoming | 你係咪小明呀？ | nei5 hai6 mai6 siu2 ming4 aa3 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-04.not-xiaoming | lesson-04 | cantonese.v6.content.lesson-04.not-xiaoming | 我唔係小明。 | ngo5 m4 hai6 siu2 ming4 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-04.i-am-xiaoming | lesson-04 | cantonese.v6.content.lesson-04.i-am-xiaoming | 我係小明。 | ngo5 hai6 siu2 ming4 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.morning | lesson-05 | cantonese.v6.content.lesson-05.morning | 早晨 | zou2 san4 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.hello | lesson-05 | cantonese.v6.content.lesson-05.hello | 你好 | nei5 hou2 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.long-time | lesson-05 | cantonese.v6.content.lesson-05.long-time | 好耐冇見 | hou2 noi6 mou5 gin3 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.please | lesson-05 | cantonese.v6.content.lesson-05.please | 唔該 | m4 goi1 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.thanks | lesson-05 | cantonese.v6.content.lesson-05.thanks | 多謝 | do1 ze6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.youre-welcome | lesson-05 | cantonese.v6.content.lesson-05.youre-welcome | 唔使客氣 | m4 sai2 haak3 hei3 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.sorry | lesson-05 | cantonese.v6.content.lesson-05.sorry | 對唔住 | deoi3 m4 zyu6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.no-matter | lesson-05 | cantonese.v6.content.lesson-05.no-matter | 唔緊要 | m4 gan2 jiu3 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.see-you | lesson-05 | cantonese.v6.content.lesson-05.see-you | 下次見 | haa6 ci3 gin3 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.thanks-contrast | lesson-05 | cantonese.v6.content.lesson-05.thanks-contrast | 唔該／多謝 | m4 goi1 / do1 ze6 | CONTRAST | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.thanks-phrase | lesson-05 | cantonese.v6.content.lesson-05.thanks-phrase | 唔該晒 | m4 goi1 saai3 | PHRASE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.how-lately | lesson-05 | cantonese.v6.content.lesson-05.how-lately | 近排點呀？ | gan6 paai4 dim2 aa3 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.im-good | lesson-05 | cantonese.v6.content.lesson-05.im-good | 我幾好，你呢？ | ngo5 gei2 hou2 nei5 ne1 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.excuse-question | lesson-05 | cantonese.v6.content.lesson-05.excuse-question | 唔該，想問你一樣嘢。 | m4 goi1 soeng2 man6 nei5 jat1 joeng6 je5 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.gift-thanks | lesson-05 | cantonese.v6.content.lesson-05.gift-thanks | 多謝你送畀我。 | do1 ze6 nei5 sung3 bei2 ngo5 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.bye | lesson-05 | cantonese.v6.content.lesson-05.bye | 我走先喇，下次見。 | ngo5 zau2 sin1 laa3 haa6 ci3 gin3 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d1a | lesson-05 | cantonese.v6.content.lesson-05.d1a | 早晨！好耐冇見。 | zou2 san4 hou2 noi6 mou5 gin3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d1b | lesson-05 | cantonese.v6.content.lesson-05.d1b | 係呀，近排點呀？ | hai6 aa3 gan6 paai4 dim2 aa3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d1c | lesson-05 | cantonese.v6.content.lesson-05.d1c | 我幾好，你呢？ | ngo5 gei2 hou2 nei5 ne1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d1d | lesson-05 | cantonese.v6.content.lesson-05.d1d | 我都幾好。得閒再傾！ | ngo5 dou1 gei2 hou2 dak1 haan4 zoi3 king1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d2a | lesson-05 | cantonese.v6.content.lesson-05.d2a | 唔該，可唔可以幫我開門？ | m4 goi1 ho2 m4 ho2 ji5 bong1 ngo5 hoi1 mun4 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d2b | lesson-05 | cantonese.v6.content.lesson-05.d2b | 得，冇問題。 | dak1 mou5 man6 tai4 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d2c | lesson-05 | cantonese.v6.content.lesson-05.d2c | 唔該晒！ | m4 goi1 saai3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d2d | lesson-05 | cantonese.v6.content.lesson-05.d2d | 唔使客氣。 | m4 sai2 haak3 hei3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d3a | lesson-05 | cantonese.v6.content.lesson-05.d3a | 對唔住，我冇留意。 | deoi3 m4 zyu6 ngo5 mou5 lau4 ji3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d3b | lesson-05 | cantonese.v6.content.lesson-05.d3b | 唔緊要，你冇事吖嘛？ | m4 gan2 jiu3 nei5 mou5 si6 aa3 maa3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d3c | lesson-05 | cantonese.v6.content.lesson-05.d3c | 冇事，多謝你。 | mou5 si6 do1 ze6 nei5 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.d3d | lesson-05 | cantonese.v6.content.lesson-05.d3d | 咁就好，拜拜。 | gam2 zau6 hou2 baai1 baai3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-05.self-compare | lesson-05 | cantonese.v6.content.lesson-05.self-compare | 唔該，可唔可以幫我開門？ | m4 goi1 ho2 m4 ho2 ji5 bong1 ngo5 hoi1 mun4 | SPEAKING_PRACTICE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.station | lesson-06 | cantonese.v6.content.lesson-06.station | 地鐵站 | dei6 tit3 zaam6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.where | lesson-06 | cantonese.v6.content.lesson-06.where | 邊度 | bin1 dou6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.how | lesson-06 | cantonese.v6.content.lesson-06.how | 點樣 | dim2 joeng2 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.straight | lesson-06 | cantonese.v6.content.lesson-06.straight | 一直行 | jat1 zik6 haang4 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.left | lesson-06 | cantonese.v6.content.lesson-06.left | 轉左 | zyun2 zo2 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.right | lesson-06 | cantonese.v6.content.lesson-06.right | 轉右 | zyun2 jau6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.cross | lesson-06 | cantonese.v6.content.lesson-06.cross | 過馬路 | gwo3 maa5 lou6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.next-stop | lesson-06 | cantonese.v6.content.lesson-06.next-stop | 下一站 | haa6 jat1 zaam6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.where-station | lesson-06 | cantonese.v6.content.lesson-06.where-station | 唔好意思，地鐵站喺邊度？ | m4 hou2 ji3 si3 dei6 tit3 zaam6 hai2 bin1 dou6 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.how-go | lesson-06 | cantonese.v6.content.lesson-06.how-go | 請問點樣去地鐵站？ | cing2 man6 dim2 joeng2 heoi3 dei6 tit3 zaam6 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.how-long | lesson-06 | cantonese.v6.content.lesson-06.how-long | 行過去要幾耐？ | haang4 gwo3 heoi3 jiu3 gei2 noi6 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.bus-go | lesson-06 | cantonese.v6.content.lesson-06.bus-go | 呢架車去唔去旺角？ | ni1 gaa3 ce1 heoi3 m4 heoi3 wong6 gok3 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.please-repeat | lesson-06 | cantonese.v6.content.lesson-06.please-repeat | 唔該，可唔可以講多次？ | m4 goi1 ho2 m4 ho2 ji5 gong2 do1 ci3 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.direction-contrast | lesson-06 | cantonese.v6.content.lesson-06.direction-contrast | 喺邊度？／點樣去？ | hai2 bin1 dou6 / dim2 joeng2 heoi3 | CONTRAST | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.junction-phrase | lesson-06 | cantonese.v6.content.lesson-06.junction-phrase | 前面個路口 | cin4 min6 go3 lou6 hau2 | PHRASE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d1a | lesson-06 | cantonese.v6.content.lesson-06.d1a | 唔好意思，地鐵站喺邊度？ | m4 hou2 ji3 si3 dei6 tit3 zaam6 hai2 bin1 dou6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d1b | lesson-06 | cantonese.v6.content.lesson-06.d1b | 一直行，前面個路口轉左。 | jat1 zik6 haang4 cin4 min6 go3 lou6 hau2 zyun2 zo2 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d1c | lesson-06 | cantonese.v6.content.lesson-06.d1c | 係咪過咗馬路就到？ | hai6 m4 hai6 gwo3 zo2 maa5 lou6 zau6 dou3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d1d | lesson-06 | cantonese.v6.content.lesson-06.d1d | 係，過咗馬路就見到。 | hai6 gwo3 zo2 maa5 lou6 zau6 gin3 dou3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d1e | lesson-06 | cantonese.v6.content.lesson-06.d1e | 唔該晒！ | m4 goi1 saai3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d2a | lesson-06 | cantonese.v6.content.lesson-06.d2a | 行過去要幾耐？ | haang4 gwo3 heoi3 jiu3 gei2 noi6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d2b | lesson-06 | cantonese.v6.content.lesson-06.d2b | 大概十分鐘。 | daai6 koi3 sap6 fan1 zung1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d2c | lesson-06 | cantonese.v6.content.lesson-06.d2c | 一直行，定係要轉彎？ | jat1 zik6 haang4 ding6 hai6 jiu3 zyun2 waan4 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d2d | lesson-06 | cantonese.v6.content.lesson-06.d2d | 行到個路口轉右。 | haang4 dou3 go3 lou6 hau2 zyun2 jau6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d3a | lesson-06 | cantonese.v6.content.lesson-06.d3a | 唔該，呢架車去唔去旺角？ | m4 goi1 ni1 gaa3 ce1 heoi3 m4 heoi3 wong6 gok3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d3b | lesson-06 | cantonese.v6.content.lesson-06.d3b | 去，你可以上車。 | heoi3 nei5 ho2 ji5 soeng5 ce1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d3c | lesson-06 | cantonese.v6.content.lesson-06.d3c | 請問喺邊個站落車？ | cing2 man6 hai2 bin1 go3 zaam6 lok6 ce1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d3d | lesson-06 | cantonese.v6.content.lesson-06.d3d | 我唔肯定，你睇下車上面嘅站牌。 | ngo5 m4 ding6 nei5 tai2 haa5 ce1 soeng6 min6 ge3 zaam6 paai4 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d4a | lesson-06 | cantonese.v6.content.lesson-06.d4a | 唔該，可唔可以講多次？ | m4 goi1 ho2 m4 ho2 ji5 gong2 do1 ci3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d4b | lesson-06 | cantonese.v6.content.lesson-06.d4b | 一直行，第二個路口轉左。 | jat1 zik6 haang4 dai6 ji6 go3 lou6 hau2 zyun2 zo2 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d4c | lesson-06 | cantonese.v6.content.lesson-06.d4c | 第二個路口轉左，係咪？ | dai6 ji6 go3 lou6 hau2 zyun2 zo2 hai6 m4 hai6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-06.d4d | lesson-06 | cantonese.v6.content.lesson-06.d4d | 係，行多陣就到。 | hai6 haang4 do1 zan6 zau6 dou3 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.dine-in | lesson-07 | cantonese.v6.content.lesson-07.dine-in | 堂食 | tong4 sik6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.takeaway | lesson-07 | cantonese.v6.content.lesson-07.takeaway | 外賣 | ngoi6 maai6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.take-away-action | lesson-07 | cantonese.v6.content.lesson-07.take-away-action | 拎走 | ling1 zau2 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.order | lesson-07 | cantonese.v6.content.lesson-07.order | 落單 | lok6 daan1 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.bill | lesson-07 | cantonese.v6.content.lesson-07.bill | 埋單 | maai4 daan1 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.less-ice | lesson-07 | cantonese.v6.content.lesson-07.less-ice | 少冰 | siu2 bing1 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.no-ice | lesson-07 | cantonese.v6.content.lesson-07.no-ice | 走冰 | zau2 bing1 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.less-sweet | lesson-07 | cantonese.v6.content.lesson-07.less-sweet | 少甜 | siu2 tim4 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.no-sweet | lesson-07 | cantonese.v6.content.lesson-07.no-sweet | 走甜 | zau2 tim4 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.sweetness-contrast | lesson-07 | cantonese.v6.content.lesson-07.sweetness-contrast | 少甜／走甜 | siu2 tim4 / zau2 tim4 | CONTRAST | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.not-spicy | lesson-07 | cantonese.v6.content.lesson-07.not-spicy | 唔要辣 | m4 jiu3 laat6 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.iced-lemon-tea | lesson-07 | cantonese.v6.content.lesson-07.iced-lemon-tea | 凍檸茶 | dung3 ning2 caa4 | WORD | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.two-people | lesson-07 | cantonese.v6.content.lesson-07.two-people | 兩位，唔該。 | loeng5 wai2 m4 goi1 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.want-this | lesson-07 | cantonese.v6.content.lesson-07.want-this | 我想要呢個。 | ngo5 soeng2 jiu3 ni1 go3 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.order-drink | lesson-07 | cantonese.v6.content.lesson-07.order-drink | 一杯凍檸茶，少冰，唔該。 | jat1 bui1 dung3 ning4 caa4 siu2 bing1 m4 goi1 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.spicy-check | lesson-07 | cantonese.v6.content.lesson-07.spicy-check | 呢個辣唔辣？ | ni1 go3 laat6 m4 laat6 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.bill-please | lesson-07 | cantonese.v6.content.lesson-07.bill-please | 唔該，埋單。 | m4 goi1 maai4 daan1 | SENTENCE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.ice-contrast | lesson-07 | cantonese.v6.content.lesson-07.ice-contrast | 少冰／走冰 | siu2 bing1 / zau2 bing1 | CONTRAST | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.less-ice-phrase | lesson-07 | cantonese.v6.content.lesson-07.less-ice-phrase | 少冰，唔該 | siu2 bing1 m4 goi1 | PHRASE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d1a | lesson-07 | cantonese.v6.content.lesson-07.d1a | 幾多位？ | gei2 do1 wai2 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d1b | lesson-07 | cantonese.v6.content.lesson-07.d1b | 兩位，唔該。 | loeng5 wai2 m4 goi1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d1c | lesson-07 | cantonese.v6.content.lesson-07.d1c | 堂食定外賣？ | tong4 sik6 ding6 ngoi6 maai6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d1d | lesson-07 | cantonese.v6.content.lesson-07.d1d | 堂食，唔該。 | tong4 sik6 m4 goi1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d2a | lesson-07 | cantonese.v6.content.lesson-07.d2a | 我想要呢個，仲有一杯凍檸茶。 | ngo5 soeng2 jiu3 ni1 go3 zung6 jau5 jat1 bui1 dung3 ning4 caa4 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d2b | lesson-07 | cantonese.v6.content.lesson-07.d2b | 杯嘢飲要唔要少冰？ | bui1 je5 jam2 jiu3 m4 jiu3 siu2 bing1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d2c | lesson-07 | cantonese.v6.content.lesson-07.d2c | 少冰就得，唔該。 | siu2 bing1 zau6 dak1 m4 goi1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d2d | lesson-07 | cantonese.v6.content.lesson-07.d2d | 好，仲要唔要其他嘢？ | hou2 zung6 jiu3 m4 jiu3 kei4 taa1 je5 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d2e | lesson-07 | cantonese.v6.content.lesson-07.d2e | 唔該，我想加多一份。 | m4 goi1 ngo5 soeng2 gaa1 do1 jat1 fan6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d3a | lesson-07 | cantonese.v6.content.lesson-07.d3a | 呢個辣唔辣？ | ni1 go3 laat6 m4 laat6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d3b | lesson-07 | cantonese.v6.content.lesson-07.d3b | 有少少辣。 | jau5 siu2 siu2 laat6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d3c | lesson-07 | cantonese.v6.content.lesson-07.d3c | 可唔可以唔要辣？ | ho2 m4 ho2 ji5 m4 jiu3 laat6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d3d | lesson-07 | cantonese.v6.content.lesson-07.d3d | 我幫你問下廚房。 | ngo5 bong1 nei5 man6 haa5 coeng4 fong2 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d4a | lesson-07 | cantonese.v6.content.lesson-07.d4a | 唔該，埋單。 | m4 goi1 maai4 daan1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d4b | lesson-07 | cantonese.v6.content.lesson-07.d4b | 好，請等一陣。 | hou2 cing2 dang2 jat1 zan6 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d4c | lesson-07 | cantonese.v6.content.lesson-07.d4c | 可唔可以用八達通？ | ho2 m4 ho2 ji5 jung6 baat3 daat6 tung1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.d4d | lesson-07 | cantonese.v6.content.lesson-07.d4d | 我睇下呢度收唔收。 | ngo5 tai2 haa5 ni1 dou6 sau1 m4 sau1 | DIALOGUE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| cantonese.v6.audio.lesson-07.self-compare | lesson-07 | cantonese.v6.content.lesson-07.self-compare | 唔該，埋單。 | m4 goi1 maai4 daan1 | SPEAKING_PRACTICE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.faan1 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.faan1 | 番 | faan1 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.ke2 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.ke2 | 茄 | ke2 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.zoeng3 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.zoeng3 | 酱 | zoeng3 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.ngau4 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.ngau4 | 牛 | ngau4 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.naam5 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.naam5 | 腩 | naam5 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.min6 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.min6 | 面 | min6 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.bat1 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.bat1 | 不 | bat1 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.hek3 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.hek3 | 吃 | hek3 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.tone.laat6 | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.laat6 | 辣 | laat6 | FOUNDATION_TONE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |
| foundation.phrase | foundation.nine-tones | cantonese.v6.content.foundation.nine-tones.phrase | 番茄酱牛腩面不吃辣 | faan1 ke2 zoeng3 ngau4 naam5 min6 bat1 hek3 laat6 | FOUNDATION_PHRASE | 真人母语粤语录音或已授权的原生粤语音频 | PENDING_TEXT_APPROVAL |

## Source Review

SOURCE_DOCUMENTED=31; SOURCE_UNKNOWN=131; ORIGINAL_ECFC_CONTENT=53.
有外部词典来源的记录仍须版权 / 授权核查；来源未知的项目不作版权安全声明。

## DISPLAY_TEXT / EXAMPLE_SENTENCE

DISPLAY_TEXT=116; EXAMPLE_SENTENCE=0。旧 pack 中重复显示文本的 98 个 examples 已停止作为例句输出；本轮没有新增例句。
内容空缺：独立的、经过审核的情境例句仍未提供。已有对话保持 DIALOGUE 类型，不重复计入 example 字段。

## Script Policy

界面说明和普通话释义可用简体中文；粤语目标词句保留实际书写形式，不做机械繁简转换。逐项文字和读音仍由人工审核。

## Runtime / Review Readiness

- Course / lesson detail / question payload：沿用 `V6CoursePackSeedPayload`，以 `lessonId` 单课读取；Lesson 01–07 顺序连续。
- Answer：使用既有受支持类型；公开 Course API 已移除 `correctAnswer`，答题由现有受保护 answer endpoint 处理。
- Progress / mistake / review：候选使用稳定 lesson/question/content IDs；Speaking 维持不评分，不进入错题或复习。
- Audio：现有 manifest ID 结构保留；无真实音频时 Listening 不能进入可学习题集。
- Schema / Migration：未改 Prisma schema 或 migration；需要人工批准及后续独立发布流程。

## Change Notes

- `LANGUAGE_TEXT_MODIFIED=NONE`。候选 01–04 的目标文字来自现有 Mobile 草稿；对 Foundation 名称只记录了审核建议，没有直接改原词。
- `EXAMPLE_SENTENCE_COUNT=0`。
- `SERVER_APPROVED_COURSES=0`；此候选不会自动改变该状态。

---

本审核文件由 `scripts/generate-cantonese-v2-human-review.ts` 从隔离候选 pack 生成。
