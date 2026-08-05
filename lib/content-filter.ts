// 统一违禁词配置（服务端 + 客户端共用）
// 以后管理员可扩展此列表；检测函数 checkForbiddenWords 返回命中词，便于后台扩展词库与提示。
// 注意：采用子串匹配，命中即拦截。例如「管理」会命中「管理处」「管理页面」等，
// 如需更精确可改为分词/正则匹配。

export const forbiddenWords: string[] = [
  // 管理 / 违规管理相关
  '管理',
  '管理员',
  '后台管理',
  '超级管理员',
  '站务',
  '版主',
  '站长',
  '审查',
  '封号',
  '封禁',
  '删帖',
  // 辱骂类
  '傻逼',
  '傻比',
  '煞笔',
  '白痴',
  '弱智',
  '贱人',
  '蠢货',
  '蠢逼',
  '脑残',
  '智障',
  // 攻击性
  '去死',
  '弄死',
  '干死',
  '杀你',
  '弄死你',
  '畜生',
  '畜牲',
  '杂种',
  '狗东西',
]

export type ForbiddenCheckResult = {
  blocked: boolean
  matchedWords: string[]
}

export function checkForbiddenWords(content: string | null | undefined): ForbiddenCheckResult {
  if (!content) return { blocked: false, matchedWords: [] }
  const text = String(content)
  const matchedWords = forbiddenWords.filter((word) => word && text.includes(word))
  return { blocked: matchedWords.length > 0, matchedWords }
}
