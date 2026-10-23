export type ReviewRisk = 'HIGH' | 'MEDIUM' | 'LOW'

export const V6_ANSWER_REVIEW_NOTES = [
  {
    questionId: 'cantonese.v6.question.lesson-05.thanks-multi', lessonId: 'lesson-05', risk: 'HIGH' as const,
    whyAmbiguous: '题干把「感谢」和「唔該」作礼貌开场混在同一判断里；第三项并非感谢，当前选项却同时问“适合用”两种表达，学习目标不够单一。',
    recommendedFix: '拆成“表达感谢”和“礼貌开场”两题，或明确题干按功能分类；人工确认后再设答案。',
  },
  {
    questionId: 'cantonese.v6.question.lesson-06.unknown-route', lessonId: 'lesson-06', risk: 'HIGH' as const,
    whyAmbiguous: '考查现实出行安全常识，选项没有呈现对应粤语说法；它不能证明学习者掌握了本课粤语。',
    recommendedFix: '改为辨认或选择一条经过审核的粤语确认句，或将安全提示移出计分题；当前答案不自动改动。',
  },
  {
    questionId: 'cantonese.v6.question.lesson-07.takeaway', lessonId: 'lesson-07', risk: 'HIGH' as const,
    whyAmbiguous: '「外賣」表示外带情境/餐食，「拎走」是动作表达；题目把不同句法角色概括成同一“词语意思”。',
    recommendedFix: '拆分为“堂食/外賣”场景选择和含「拎走」的完整句理解题；先由粤语审核员确认自然语境。',
  },
  {
    questionId: 'cantonese.v6.question.lesson-07.payment-multi', lessonId: 'lesson-07', risk: 'HIGH' as const,
    whyAmbiguous: '多选项同时混合粤语表达、支付方式事实和服务流程，未明确考查词句还是行为规范。',
    recommendedFix: '保留语言学习目标，改为辨认「埋單」或询问支付方式的表达；把等待店员确认留作非计分提示。',
  },
] as const

export const V6_SHALLOW_EXPLANATION_NOTES = [
  { questionId: 'cantonese.v6.question.lesson-05.review-true', suggestedExplanation: '「唔使客氣」在本课对话里回应对方的道谢；请人工确认该场景中的语气、文字和读音。' },
  { questionId: 'cantonese.v6.question.lesson-06.left', suggestedExplanation: '在本题的路线语境里，「轉左」表示向左转；「轉」的方向义粤拼候选仍待确认。' },
  { questionId: 'cantonese.v6.question.lesson-06.right', suggestedExplanation: '在本题的路线语境里，「轉右」表示向右转；请结合路口场景核对表达与读音。' },
  { questionId: 'cantonese.v6.question.lesson-06.where-true', suggestedExplanation: '「喺」在此标示地点，「邊度」询问位置；组合后可用于询问某处在哪里。语法讲解待粤语审核。' },
  { questionId: 'cantonese.v6.question.lesson-07.dine-or-take', suggestedExplanation: '「堂食」对应在店内用餐；「外賣」对应外带/外送语境。实际用法及地域习惯仍需确认。' },
  { questionId: 'cantonese.v6.question.lesson-07.ice-difference', suggestedExplanation: '本课把「少冰」作为减少冰量、「走冰」作为不加冰的对比；请人工核对餐饮场景中的实际用法。' },
  { questionId: 'cantonese.v6.question.lesson-07.spice-question', suggestedExplanation: '「呢個辣唔辣？」是在询问这道食物是否辣，不代表店员已确认配料或能否调整。' },
] as const

export const V6_LANGUAGE_REVIEW_QUEUE = [
  { itemId: 'cantonese.v6.content.lesson-05.hello', lessonId: 'lesson-01 / lesson-05', currentText: '你好', issue: '与迁入的 Lesson 01 词条完全重复；现有 Lesson 05 稳定 ID 不可静默删除。', suggestedText: '建议 Lesson 01 作为首次教学；Lesson 05 词条待审核后并入/改为上下文复现。', confidence: 'HIGH' as const, humanReviewRequired: true },
  { itemId: 'cantonese.v6.content.lesson-05.morning', lessonId: 'lesson-01 / lesson-05', currentText: '早晨', issue: '与迁入的 Lesson 01 词条完全重复；Lesson 05 对话另有真实语境复现。', suggestedText: '建议合并首次教学记录，保留 Lesson 05 对话；不自动移除旧记录。', confidence: 'HIGH' as const, humanReviewRequired: true },
  { itemId: 'cantonese.v6.content.lesson-06.left', lessonId: 'lesson-06', currentText: '轉左', issue: '「轉」在方向词组中的读音需核对多音及口音差异。', suggestedText: '暂存 Jyutping 候选 zyun2 zo2；请审核后裁定。', confidence: 'LOW' as const, humanReviewRequired: true },
  { itemId: 'cantonese.v6.content.lesson-06.right', lessonId: 'lesson-06', currentText: '轉右', issue: '「轉」在方向词组中的读音需核对多音及口音差异。', suggestedText: '暂存 Jyutping 候选 zyun2 jau6；请审核后裁定。', confidence: 'LOW' as const, humanReviewRequired: true },
  { itemId: 'cantonese.v6.content.lesson-06.straight', lessonId: 'lesson-06', currentText: '一直行', issue: '「行」有多个粤语读音；此处按“步行”义暂候选 haang4。', suggestedText: '逐字确认「行」在本语境的读音。', confidence: 'LOW' as const, humanReviewRequired: true },
  { itemId: 'cantonese.v6.content.lesson-07.order-drink', lessonId: 'lesson-07', currentText: '凍檸茶', issue: '当前已有但未审核的 Jyutping 与本轮长句候选对「檸」使用不同声调。', suggestedText: '核查后统一所有包含「檸」的条目；不在本轮覆盖现有读音。', confidence: 'LOW' as const, humanReviewRequired: true },
  { itemId: 'foundation.nine-tones.phrase', lessonId: 'Foundation', currentText: '番茄酱牛腩面不吃辣', issue: 'Mobile Foundation 使用的名称多一个「酱」，与正式功能名称不一致。', suggestedText: '人工确认是否统一为正式名称「番茄牛腩面不吃辣」。', confidence: 'HIGH' as const, humanReviewRequired: true },
] as const

export const V6_SOURCE_STATUS = {
  ORIGINAL_MOBILE_DRAFT: 'ORIGINAL_ECFC_CONTENT',
  DOCUMENTED: 'SOURCE_DOCUMENTED',
  UNKNOWN: 'SOURCE_UNKNOWN',
} as const
