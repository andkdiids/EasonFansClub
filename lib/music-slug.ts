// 演唱会资料库 URL slug 生成工具（纯函数，无数据库依赖，可前后端共用）。
//
// 设计原则（来自需求）：
// - 巡演 URL 段由 MusicTour.name 动态生成，不使用数据库 id / 不新增字段。
// - 巡演 slug：保留原始英文大小写，空格转连字符，删除特殊符号，不自动转小写。
//   例：Fear and Dreams -> Fear-and-Dreams；Eason's LIFE -> Easons-LIFE
// - 城市 slug：英文字母全部大写，空格转连字符，不改变数据库 city 字段。
//   例：Hong Kong -> HONG-KONG；Singapore -> SINGAPORE

export function generateArchiveSlug(text: string): string {
  return String(text ?? '')
    .replace(/['‘’`]/g, '') // 去掉撇号：Eason's -> Easons
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // 去掉其他特殊符号（保留字母/数字/空格/连字符，含中文）
    .replace(/_/g, '') // 去掉下划线
    .trim()
    .replace(/\s+/g, '-') // 空格转连字符
    .replace(/-+/g, '-') // 合并连续连字符
}

export function generateCitySlug(city: string): string {
  return String(city ?? '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/_/g, '')
    .trim()
    .toUpperCase() // 城市整体大写
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}
