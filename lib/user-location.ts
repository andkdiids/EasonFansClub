import { getCountries, type CountryCode } from 'libphonenumber-js/min'

export type UserLocation = {
  countryCode: string
  countryName: string
  regionCode: string | null
  regionName: string | null
}

export type LocationCountry = {
  code: string
  name: string
  searchText: string
}

export type LocationRegion = {
  code: string
  name: string
  aliases?: string[]
}

const countryNameOverrides: Record<string, string> = {
  CN: '中国',
  HK: '中国香港',
  MO: '中国澳门',
  TW: '中国台湾',
  JP: '日本',
  KR: '韩国',
  SG: '新加坡',
  MY: '马来西亚',
  TH: '泰国',
  GB: '英国',
  US: '美国',
  CA: '加拿大',
  AU: '澳大利亚',
  NZ: '新西兰',
  FR: '法国',
  DE: '德国',
  ES: '西班牙',
  IT: '意大利',
  RU: '俄罗斯',
  IN: '印度',
  BR: '巴西',
  MX: '墨西哥',
}

function getCountryName(code: string) {
  if (countryNameOverrides[code]) return countryNameOverrides[code]
  try {
    return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s·.,，。/\\_-]+/g, '')
}

const popularCountryCodes = ['CN', 'HK', 'MO', 'TW', 'JP', 'KR', 'SG', 'MY', 'TH', 'US', 'CA', 'GB', 'AU']

const region = (code: string, name: string, aliases: string[] = []): LocationRegion => ({ code, name, aliases })

const locationRegions: Record<string, LocationRegion[]> = {
  CN: [
    region('CN-11', '北京'), region('CN-12', '天津'), region('CN-13', '河北'), region('CN-14', '山西'), region('CN-15', '内蒙古'),
    region('CN-21', '辽宁'), region('CN-22', '吉林'), region('CN-23', '黑龙江'), region('CN-31', '上海'), region('CN-32', '江苏'),
    region('CN-33', '浙江'), region('CN-34', '安徽'), region('CN-35', '福建'), region('CN-36', '江西'), region('CN-37', '山东'),
    region('CN-41', '河南'), region('CN-42', '湖北'), region('CN-43', '湖南'), region('CN-44', '广东'), region('CN-45', '广西'),
    region('CN-46', '海南'), region('CN-50', '重庆'), region('CN-51', '四川'), region('CN-52', '贵州'), region('CN-53', '云南'),
    region('CN-54', '西藏'), region('CN-61', '陕西'), region('CN-62', '甘肃'), region('CN-63', '青海'), region('CN-64', '宁夏'),
    region('CN-65', '新疆'),
  ],
  HK: [region('HK', '香港')],
  MO: [region('MO', '澳门')],
  TW: [region('TW', '台湾')],
  JP: [
    region('JP-01', '北海道'), region('JP-02', '青森县'), region('JP-03', '岩手县'), region('JP-04', '宫城县'), region('JP-05', '秋田县'),
    region('JP-06', '山形县'), region('JP-07', '福岛县'), region('JP-08', '茨城县'), region('JP-09', '栃木县'), region('JP-10', '群马县'),
    region('JP-11', '埼玉县'), region('JP-12', '千叶县'), region('JP-13', '东京都', ['东京', 'Tokyo']), region('JP-14', '神奈川县', ['横滨']),
    region('JP-15', '新潟县'), region('JP-16', '富山县'), region('JP-17', '石川县'), region('JP-18', '福井县'), region('JP-19', '山梨县'),
    region('JP-20', '长野县'), region('JP-21', '岐阜县'), region('JP-22', '静冈县'), region('JP-23', '爱知县', ['名古屋']), region('JP-24', '三重县'),
    region('JP-25', '滋贺县'), region('JP-26', '京都府', ['京都', 'Kyoto']), region('JP-27', '大阪府', ['大阪', 'Osaka']), region('JP-28', '兵库县'),
    region('JP-29', '奈良县'), region('JP-30', '和歌山县'), region('JP-31', '鸟取县'), region('JP-32', '岛根县'), region('JP-33', '冈山县'),
    region('JP-34', '广岛县'), region('JP-35', '山口县'), region('JP-36', '德岛县'), region('JP-37', '香川县'), region('JP-38', '爱媛县'),
    region('JP-39', '高知县'), region('JP-40', '福冈县'), region('JP-41', '佐贺县'), region('JP-42', '长崎县'), region('JP-43', '熊本县'),
    region('JP-44', '大分县'), region('JP-45', '宫崎县'), region('JP-46', '鹿儿岛县'), region('JP-47', '冲绳县'),
  ],
  US: [
    region('US-AL', '阿拉巴马州'), region('US-AK', '阿拉斯加州'), region('US-AZ', '亚利桑那州'), region('US-AR', '阿肯色州'), region('US-CA', '加利福尼亚州', ['California', 'Los Angeles', '洛杉矶']),
    region('US-CO', '科罗拉多州'), region('US-CT', '康涅狄格州'), region('US-DE', '特拉华州'), region('US-FL', '佛罗里达州', ['Florida', 'Miami']), region('US-GA', '佐治亚州'),
    region('US-HI', '夏威夷州'), region('US-ID', '爱达荷州'), region('US-IL', '伊利诺伊州', ['Illinois', 'Chicago']), region('US-IN', '印第安纳州'), region('US-IA', '爱荷华州'),
    region('US-KS', '堪萨斯州'), region('US-KY', '肯塔基州'), region('US-LA', '路易斯安那州'), region('US-ME', '缅因州'), region('US-MD', '马里兰州'),
    region('US-MA', '马萨诸塞州', ['Massachusetts', 'Boston']), region('US-MI', '密歇根州'), region('US-MN', '明尼苏达州'), region('US-MS', '密西西比州'), region('US-MO', '密苏里州'),
    region('US-MT', '蒙大拿州'), region('US-NE', '内布拉斯加州'), region('US-NV', '内华达州', ['Nevada', 'Las Vegas']), region('US-NH', '新罕布什尔州'), region('US-NJ', '新泽西州'),
    region('US-NM', '新墨西哥州'), region('US-NY', '纽约州', ['New York', '纽约']), region('US-NC', '北卡罗来纳州'), region('US-ND', '北达科他州'), region('US-OH', '俄亥俄州'),
    region('US-OK', '俄克拉何马州'), region('US-OR', '俄勒冈州'), region('US-PA', '宾夕法尼亚州'), region('US-RI', '罗得岛州'), region('US-SC', '南卡罗来纳州'),
    region('US-SD', '南达科他州'), region('US-TN', '田纳西州'), region('US-TX', '得克萨斯州', ['Texas', 'Houston']), region('US-UT', '犹他州'), region('US-VT', '佛蒙特州'),
    region('US-VA', '弗吉尼亚州'), region('US-WA', '华盛顿州', ['Washington', 'Seattle']), region('US-WV', '西弗吉尼亚州'), region('US-WI', '威斯康星州'), region('US-WY', '怀俄明州'),
    region('US-DC', '华盛顿哥伦比亚特区', ['Washington DC', 'Washington, D.C.']),
  ],
  CA: [region('CA-AB', '艾伯塔省', ['Alberta']), region('CA-BC', '不列颠哥伦比亚省', ['British Columbia', 'Vancouver']), region('CA-MB', '马尼托巴省'), region('CA-NB', '新不伦瑞克省'), region('CA-NL', '纽芬兰与拉布拉多省'), region('CA-NS', '新斯科舍省'), region('CA-NT', '西北地区'), region('CA-NU', '努纳武特地区'), region('CA-ON', '安大略省', ['Ontario', 'Toronto']), region('CA-PE', '爱德华王子岛省'), region('CA-QC', '魁北克省', ['Quebec', 'Montreal']), region('CA-SK', '萨斯喀彻温省'), region('CA-YT', '育空地区')],
  GB: [region('GB-ENG', '英格兰', ['England', 'London', '伦敦']), region('GB-SCT', '苏格兰', ['Scotland']), region('GB-WLS', '威尔士', ['Wales']), region('GB-NIR', '北爱尔兰', ['Northern Ireland'])],
  AU: [region('AU-NSW', '新南威尔士州', ['New South Wales', 'Sydney']), region('AU-QLD', '昆士兰州', ['Queensland', 'Brisbane']), region('AU-SA', '南澳大利亚州'), region('AU-TAS', '塔斯马尼亚州'), region('AU-VIC', '维多利亚州', ['Victoria', 'Melbourne']), region('AU-WA', '西澳大利亚州', ['Western Australia', 'Perth']), region('AU-ACT', '澳大利亚首都领地'), region('AU-NT', '北领地')],
  DE: [region('DE-BW', '巴登-符腾堡州'), region('DE-BY', '巴伐利亚州', ['Bavaria', 'Munich']), region('DE-BE', '柏林州', ['Berlin', '柏林']), region('DE-BB', '勃兰登堡州'), region('DE-HB', '不来梅州'), region('DE-HH', '汉堡州', ['Hamburg', '汉堡']), region('DE-HE', '黑森州'), region('DE-MV', '梅克伦堡-前波美拉尼亚州'), region('DE-NI', '下萨克森州'), region('DE-NW', '北莱茵-威斯特法伦州'), region('DE-RP', '莱茵兰-普法尔茨州'), region('DE-SL', '萨尔州'), region('DE-SN', '萨克森州'), region('DE-ST', '萨克森-安哈尔特州'), region('DE-SH', '石勒苏益格-荷尔斯泰因州'), region('DE-TH', '图林根州')],
  FR: [region('FR-IDF', '法兰西岛大区', ['Île-de-France', 'Paris', '巴黎']), region('FR-ARA', '奥弗涅-罗讷-阿尔卑斯大区'), region('FR-BFC', '勃艮第-弗朗什-孔泰大区'), region('FR-BRE', '布列塔尼大区'), region('FR-CVL', '中央-卢瓦尔河谷大区'), region('FR-COR', '科西嘉大区'), region('FR-GES', '大东部大区'), region('FR-HDF', '上法兰西大区'), region('FR-NOR', '诺曼底大区'), region('FR-NAQ', '新阿基坦大区'), region('FR-OCC', '奥克西塔尼大区'), region('FR-PDL', '卢瓦尔河地区大区'), region('FR-PAC', '普罗旺斯-阿尔卑斯-蓝色海岸大区'), region('FR-GP', '瓜德罗普'), region('FR-MQ', '马提尼克'), region('FR-GF', '法属圭亚那'), region('FR-RE', '留尼汪'), region('FR-YT', '马约特')],
  KR: [region('KR-11', '首尔特别市', ['Seoul', '首尔']), region('KR-26', '釜山广域市'), region('KR-27', '大邱广域市'), region('KR-28', '仁川广域市'), region('KR-29', '光州广域市'), region('KR-30', '大田广域市'), region('KR-31', '蔚山广域市'), region('KR-41', '京畿道'), region('KR-42', '江原特别自治道'), region('KR-43', '忠清北道'), region('KR-44', '忠清南道'), region('KR-45', '全罗北道'), region('KR-46', '全罗南道'), region('KR-47', '庆尚北道'), region('KR-48', '庆尚南道'), region('KR-49', '济州特别自治道'), region('KR-50', '世宗特别自治市')],
  IN: [region('IN-DL', '德里', ['Delhi']), region('IN-MH', '马哈拉施特拉邦', ['Maharashtra', 'Mumbai']), region('IN-KA', '卡纳塔克邦', ['Karnataka', 'Bengaluru']), region('IN-TN', '泰米尔纳德邦'), region('IN-WB', '西孟加拉邦', ['West Bengal', 'Kolkata']), region('IN-GJ', '古吉拉特邦'), region('IN-RJ', '拉贾斯坦邦'), region('IN-UP', '北方邦'), region('IN-KL', '喀拉拉邦'), region('IN-AP', '安得拉邦'), region('IN-TG', '特伦甘纳邦'), region('IN-BR', '比哈尔邦'), region('IN-MP', '中央邦'), region('IN-PB', '旁遮普邦'), region('IN-HR', '哈里亚纳邦'), region('IN-OR', '奥里萨邦')],
  MY: [region('MY-01', '柔佛州', ['Johor']), region('MY-02', '吉打州', ['Kedah']), region('MY-03', '吉兰丹州'), region('MY-04', '马六甲州', ['Malacca']), region('MY-05', '森美兰州'), region('MY-06', '彭亨州'), region('MY-07', '槟城州', ['Penang']), region('MY-08', '霹雳州'), region('MY-09', '玻璃市州'), region('MY-10', '雪兰莪州', ['Selangor', 'Kuala Lumpur']), region('MY-11', '登嘉楼州'), region('MY-12', '沙巴州'), region('MY-13', '砂拉越州'), region('MY-14', '吉隆坡', ['Kuala Lumpur']), region('MY-15', '纳闽'), region('MY-16', '布城')],
  BR: [region('BR-SP', '圣保罗州', ['São Paulo', 'Sao Paulo']), region('BR-RJ', '里约热内卢州', ['Rio de Janeiro']), region('BR-MG', '米纳斯吉拉斯州'), region('BR-BA', '巴伊亚州'), region('BR-PR', '巴拉那州'), region('BR-RS', '南里奥格兰德州'), region('BR-PE', '伯南布哥州'), region('BR-CE', '塞阿拉州'), region('BR-PA', '帕拉州'), region('BR-SC', '圣卡塔琳娜州'), region('BR-GO', '戈亚斯州'), region('BR-AM', '亚马孙州'), region('BR-DF', '联邦区', ['Brasília', '巴西利亚'])],
  MX: [region('MX-CMX', '墨西哥城', ['Mexico City']), region('MX-JAL', '哈利斯科州', ['Jalisco', 'Guadalajara']), region('MX-NL', '新莱昂州', ['Nuevo León', 'Monterrey']), region('MX-BCN', '下加利福尼亚州'), region('MX-PUE', '普埃布拉州'), region('MX-VER', '韦拉克鲁斯州'), region('MX-YUC', '尤卡坦州'), region('MX-QRO', '克雷塔罗州')],
}

export const LOCATION_COUNTRIES: LocationCountry[] = [...new Set(getCountries() as CountryCode[])].map((code) => {
  const normalizedCode = String(code).toUpperCase()
  const name = getCountryName(normalizedCode)
  return { code: normalizedCode, name, searchText: normalizeSearch(`${normalizedCode} ${name}`) }
}).sort((left, right) => {
  const leftIndex = popularCountryCodes.indexOf(left.code)
  const rightIndex = popularCountryCodes.indexOf(right.code)
  if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex)
  return left.name.localeCompare(right.name, 'zh-CN')
})

export function getLocationRegions(countryCode: string) {
  return locationRegions[countryCode.toUpperCase()] || []
}

export function getLocationCountry(countryCode: string) {
  return LOCATION_COUNTRIES.find((country) => country.code === countryCode.toUpperCase()) || null
}

export function searchLocationCountries(query: string) {
  const normalized = normalizeSearch(query)
  if (!normalized) return LOCATION_COUNTRIES
  return LOCATION_COUNTRIES.filter((country) => country.searchText.includes(normalized))
}

export function searchLocationRegions(countryCode: string, query: string) {
  const normalized = normalizeSearch(query)
  const regions = getLocationRegions(countryCode)
  if (!normalized) return regions
  return regions.filter((item) => normalizeSearch(`${item.code} ${item.name} ${(item.aliases || []).join(' ')}`).includes(normalized))
}

export function searchAllLocationRegions(query: string) {
  const normalized = normalizeSearch(query)
  if (!normalized) return []
  return LOCATION_COUNTRIES.flatMap((country) => searchLocationRegions(country.code, query).map((regionItem) => ({ country, region: regionItem })))
}

export function normalizeUserLocationInput(value: unknown): UserLocation | null | undefined {
  if (value === null || value === '') return null
  if (!value || typeof value !== 'object') return undefined

  const source = value as { countryCode?: unknown; regionCode?: unknown }
  const countryCode = typeof source.countryCode === 'string' ? source.countryCode.toUpperCase() : ''
  const country = getLocationCountry(countryCode)
  if (!country) return undefined

  const rawRegionCode = typeof source.regionCode === 'string' ? source.regionCode.trim() : ''
  const regions = getLocationRegions(country.code)
  if (!rawRegionCode) {
    return { countryCode: country.code, countryName: country.name, regionCode: null, regionName: null }
  }
  const selectedRegion = regions.find((item) => item.code === rawRegionCode)
  if (!selectedRegion) return undefined

  return {
    countryCode: country.code,
    countryName: country.name,
    regionCode: selectedRegion.code,
    regionName: selectedRegion.name,
  }
}

export function formatUserLocation(location: UserLocation | null | undefined) {
  if (!location) return ''
  return location.regionName ? `${location.countryName} · ${location.regionName}` : location.countryName
}

export function locationFromProfile(profile: {
  locationCountryCode?: string | null
  locationCountry?: string | null
  locationRegionCode?: string | null
  locationRegion?: string | null
} | null | undefined): UserLocation | null {
  if (!profile?.locationCountryCode) return null
  const normalized = normalizeUserLocationInput({ countryCode: profile.locationCountryCode, regionCode: profile.locationRegionCode })
  if (normalized === undefined) return null
  if (normalized === null) return null
  return normalized
}
