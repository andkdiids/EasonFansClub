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
