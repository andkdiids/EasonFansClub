// 演唱会资料库 URL slug 生成工具（纯函数，无数据库依赖，可前后端共用）。
//
// 设计原则（来自需求）：
// - 巡演 URL 段由 MusicTour.name 动态生成，不使用数据库 id / 不新增字段。
// - 巡演 slug：保留原始英文大小写，空格转连字符，删除特殊符号，不自动转小写。
//   例：Fear and Dreams -> Fear-and-Dreams；Eason's LIFE -> Easons-LIFE
// - 城市 slug：统一转为英文并整体大写，空格转连字符，不改变数据库 city 字段。
//   例：香港 -> HONG-KONG；澳门 -> MACAU；上海 -> SHANGHAI；深圳 -> SHEN-ZHEN；
//       Hong Kong -> HONG-KONG；Singapore -> SINGAPORE
//
// 注意：以下映射仅用于「生成 URL」，绝不写回数据库。数据库 city 字段保持原样。

// 中文城市名 -> 英文（用于生成大写英文 slug）。仅覆盖资料库实际出现 / 可能出现的城市。
const CITY_NAME_EN: Record<string, string> = {
  香港: 'Hong Kong',
  澳门: 'Macau',
  台北: 'Taipei',
  台中: 'Taichung',
  高雄: 'Kaohsiung',
  台南: 'Tainan',
  桃园: 'Taoyuan',
  北京: 'Beijing',
  上海: 'Shanghai',
  广州: 'Guangzhou',
  深圳: 'Shen Zhen',
  成都: 'Chengdu',
  重庆: 'Chongqing',
  杭州: 'Hangzhou',
  南京: 'Nanjing',
  武汉: 'Wuhan',
  天津: 'Tianjin',
  西安: 'Xian',
  长沙: 'Changsha',
  苏州: 'Suzhou',
  厦门: 'Xiamen',
  新加坡: 'Singapore',
  吉隆坡: 'Kuala Lumpur',
  纽约: 'New York',
  多伦多: 'Toronto',
  芝加哥: 'Chicago',
  安纳海姆: 'Anaheim',
  旧金山: 'San Francisco',
  温哥华: 'Vancouver',
  青岛: 'Qingdao',
  昆明: 'Kunming',
  南宁: 'Nanning',
  福州: 'Fuzhou',
  郑州: 'Zhengzhou',
  济南: 'Jinan',
  合肥: 'Hefei',
  沈阳: 'Shenyang',
  大连: 'Dalian',
  哈尔滨: 'Harbin',
  长春: 'Changchun',
  贵阳: 'Guiyang',
  太原: 'Taiyuan',
  石家庄: 'Shijiazhuang',
  南昌: 'Nanchang',
  宁波: 'Ningbo',
  无锡: 'Wuxi',
  佛山: 'Foshan',
  东莞: 'Dongguan',
  珠海: 'Zhuhai',
  温州: 'Wenzhou',
  常州: 'Changzhou',
  徐州: 'Xuzhou',
  南通: 'Nantong',
  泉州: 'Quanzhou',
  烟台: 'Yantai',
  潍坊: 'Weifang',
  兰州: 'Lanzhou',
  乌鲁木齐: 'Urumqi',
  呼和浩特: 'Hohhot',
  银川: 'Yinchuan',
  西宁: 'Xining',
  海口: 'Haikou',
  三亚: 'Sanya',
  桂林: 'Guilin',
  丽江: 'Lijiang',
  拉萨: 'Lhasa',
  包头: 'Baotou',
  唐山: 'Tangshan',
  保定: 'Baoding',
  芜湖: 'Wuhu',
  嘉兴: 'Jiaxing',
  绍兴: 'Shaoxing',
  金华: 'Jinhua',
  台州: 'Taizhou',
  舟山: 'Zhoushan',
  威海: 'Weihai',
  淄博: 'Zibo',
  临沂: 'Linyi',
  盐城: 'Yancheng',
  扬州: 'Yangzhou',
  镇江: 'Zhenjiang',
  湖州: 'Huzhou',
  衢州: 'Quzhou',
  绵阳: 'Mianyang',
  宜宾: 'Yibin',
  乐山: 'Leshan',
  南充: 'Nanchong',
  泸州: 'Luzhou',
  遵义: 'Zunyi',
  北海: 'Beihai',
  柳州: 'Liuzhou',
  鄂尔多斯: 'Ordos',
  张家界: 'Zhangjiajie',
  张家港: 'Zhangjiagang',
}

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
  const normalized = String(city ?? '').trim()
  // 中文城市名先转成英文（仅用于 URL，不改数据库）；英文城市保持原样
  const english = CITY_NAME_EN[normalized] ?? normalized
  return String(english ?? '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/_/g, '')
    .trim()
    .toUpperCase() // 城市整体大写
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

// 城市分组类型：普通巡演城市 / 返场城市 / 特殊场次（最终站）。
// 同一物理城市可能存在「首次演出」「返场演出」「最终站」三类记录，
// 数据库 city 字段以「城市（标签）」形式区分（例如 香港 / 香港（返场） / 澳门（最终站））。
export type CityGroupType = 'normal' | 'encore' | 'final'

// 场次类型（与 Prisma enum ConcertStageType 对应）。新后台创建记录时使用，
// city 字段只保存真实城市，不再用「城市（标签）」编码返场/最终站。
export type ConcertStageType = 'NORMAL' | 'ENCORE' | 'FINAL'

const CITY_GROUP_ENCORE_TAGS = ['返场', '安可', '加场', '加演', '重演', 'encore']
const CITY_GROUP_FINAL_TAGS = ['最终站', '终场', '最终场', '收官场', '压轴', 'final']

// 将数据库 stageType 映射到城市分组类型；NORMAL 表示「以 city 标签为准」（兼容旧数据）。
export function stageTypeToGroupType(stageType?: ConcertStageType | string | null): CityGroupType {
  if (stageType === 'ENCORE') return 'encore'
  if (stageType === 'FINAL') return 'final'
  return 'normal'
}

// 计算「有效城市分组」：
// - 新数据：stageType 权威（ENCORE/FINAL），city 已是干净真实城市，直接用 stageType 决定类型；
// - 旧数据：stageType 默认 NORMAL，回退到 city 标签解析（保持向后兼容）。
export function effectiveCityGroup(
  city: string,
  stageType?: ConcertStageType | string | null,
): { base: string; type: CityGroupType; tag: string } {
  const groupType = stageTypeToGroupType(stageType)
  if (groupType !== 'normal') {
    const parsed = parseCityGroup(city)
    return { base: parsed.base, type: groupType, tag: CITY_GROUP_TYPE_LABEL[groupType] }
  }
  return parseCityGroup(city)
}

const CITY_GROUP_TYPE_SUFFIX: Record<CityGroupType, string> = {
  normal: '',
  encore: '-ENCORE',
  final: '-FINAL',
}

// 卡片/详情页展示用的中文标签（仅展示，不写回数据库）。
export const CITY_GROUP_TYPE_LABEL: Record<CityGroupType, string> = {
  normal: '',
  encore: '返场',
  final: '最终站',
}

// 解析城市字符串，提取基础城市名与场次类型。
// 例：
//   香港        -> { base: '香港',        type: 'normal' }
//   香港（返场） -> { base: '香港',        type: 'encore' }
//   澳门（最终站）-> { base: '澳门',        type: 'final'  }
//   台湾高雄     -> { base: '台湾高雄',     type: 'normal' }
//   香港（特别场）-> { base: '香港（特别场）', type: 'normal' }（未识别标签：保留原串以避免与无标签同名城市冲突）
export function parseCityGroup(city: string): { base: string; type: CityGroupType; tag: string } {
  const raw = String(city ?? '').trim()
  const match = raw.match(/^(.*?)\s*[（(]([^（）()]*)[)）]\s*$/)
  if (match) {
    const base = match[1].trim()
    const tag = match[2].trim()
    const lower = tag.toLowerCase()
    if (CITY_GROUP_FINAL_TAGS.some((token) => lower.includes(token.toLowerCase()))) {
      return { base, type: 'final', tag }
    }
    if (CITY_GROUP_ENCORE_TAGS.some((token) => lower.includes(token.toLowerCase()))) {
      return { base, type: 'encore', tag }
    }
    // 未识别的括号标签：保留完整原串作为 base，避免与无标签同名城市 slug 冲突
    return { base: raw, type: 'normal', tag }
  }
  return { base: raw, type: 'normal', tag: '' }
}

// 由基础城市名 + 类型生成分组 slug（用于 URL，不写回数据库）。
// 普通城市保持与原 generateCitySlug 一致（向后兼容旧链接）；返场/最终站追加类型后缀以去重。
export function cityGroupSlug(base: string, type: CityGroupType): string {
  return `${generateCitySlug(base)}${CITY_GROUP_TYPE_SUFFIX[type]}`
}

// 由数据库 city 字段（以及可选的 stageType）生成分组 slug（用于 URL，不写回数据库）。
// - 提供 stageType 时以 stageType 为准（新数据，city 为干净真实城市）；
// - 省略 stageType 时回退到 city 标签解析（兼容旧数据 / 调用方尚未迁移）。
export function generateCityGroupSlug(city: string, stageType?: ConcertStageType | string | null): string {
  const { base, type } = effectiveCityGroup(city, stageType)
  return cityGroupSlug(base, type)
}

// 单场日期 slug：数据库日期 2022-12-10 -> 20221210。
// 注意：使用 UTC 提取日历日期，与 lib/music-live.ts 的 formatLiveDate（timeZone: 'UTC'）保持一致，
// 确保 URL 中的日期与页面展示的日期完全相同。仅用于生成 URL，不写回数据库。
// 可选 startTime：同一天多场（如下午场/晚上场）时，slug 追加 -HHMM 以区分不同场次，
// 避免详情链接互相覆盖；无 startTime 时退化为纯 YYYYMMDD（兼容旧 URL）。
export function generateDateSlug(date: Date | string, startTime?: Date | string | null): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const base = `${y}${m}${day}`
  if (startTime) {
    const t = typeof startTime === 'string' ? new Date(startTime) : startTime
    if (!Number.isNaN(t.getTime())) {
      const hh = String(t.getUTCHours()).padStart(2, '0')
      const mm = String(t.getUTCMinutes()).padStart(2, '0')
      return `${base}-${hh}${mm}`
    }
  }
  return base
}

// 单场公开地址：/music/live/tours/<tourSlug>/<CITY_GROUP>/<YYYYMMDD>。
// 城市段使用分组 slug（基础城市 + 类型后缀），避免同名城市不同场次（返场/最终站）路由冲突。
// 纯函数（不依赖 prisma），服务端/客户端组件均可调用，统一避免暴露 CUID。
// 单场公开地址：/music/live/tours/<tourSlug>/<CITY_GROUP>/<YYYYMMDD>。
// 城市段使用分组 slug（基础城市 + 类型后缀），避免同名城市不同场次（返场/最终站）路由冲突。
// 提供 stageType 时以 stageType 为准（新数据），否则回退到 city 标签解析（旧数据）。
export function buildConcertSlugPath(tourName: string, city: string, concertDate: Date | string, stageType?: ConcertStageType | string | null): string {
  return `/music/live/tours/${generateArchiveSlug(tourName)}/${generateCityGroupSlug(city, stageType)}/${generateDateSlug(concertDate)}`
}
