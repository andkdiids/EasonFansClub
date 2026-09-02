import { deltaE76, hexToRgb, rgbToLab } from './color'
import type { BeadBrand, BeadLab, BeadPaletteColor, BeadPaletteMode, BeadPaletteSource, BeadRgb } from './types'

export type PaletteModeDefinition = Readonly<{
  id: BeadPaletteMode
  label: string
  shortLabel: string
  targetCount: number
}>

export type PaletteRegistryEntry = Readonly<{
  brand: string
  brandCode: string
  originalCode?: string
  displayCode?: string
  series: string
  code: string
  name: string
  hex: string
  rgb: BeadRgb
  lab: BeadLab
  enabled: boolean
  groups: readonly string[]
  source: BeadPaletteSource
}>

/** Source marker retained for the existing legacy catalogue. */
export const PALETTE_SOURCE = 'EXISTING' as const
export const PALETTE_SOURCE_NOTE = '当前使用 MARD / 221 完整色板。'
export const MARD_221_SOURCE = 'VERIFIED' as const
export const MARD_221_PDF_SOURCE = 'E:/电脑管家迁移文件/xwechat_files/linyoujia110_a122/msg/file/2026-09/色值数据-总表-221色表格7584396780075656452.pdf'
export const MARD_221_SOURCE_NOTE = 'MARD / 221：来自用户提供的《色值数据-总表-221色表格7584396780075656452.pdf》；HEX 与色块为颜色基准，Lab 已静态预计算。'

/**
 * The supplied PDF has seven rows whose printed RGB column disagrees with
 * the printed HEX value and its swatch. Runtime RGB uses the HEX-decoded
 * value; keeping the exceptions explicit prevents a silent correction.
 */
export const MARD_221_SOURCE_EXCEPTIONS = [
  { code: 'B6', hex: '#64B0A4', printedRgb: { r: 100, g: 224, b: 164 }, canonicalRgb: { r: 100, g: 176, b: 164 } },
  { code: 'B31', hex: '#B2F694', printedRgb: { r: 178, g: 230, b: 148 }, canonicalRgb: { r: 178, g: 246, b: 148 } },
  { code: 'E6', hex: '#BC4072', printedRgb: { r: 236, g: 64, b: 114 }, canonicalRgb: { r: 188, g: 64, b: 114 } },
  { code: 'F9', hex: '#B0677A', printedRgb: { r: 224, g: 103, b: 122 }, canonicalRgb: { r: 176, g: 103, b: 122 } },
  { code: 'G1', hex: '#FFEAD3', printedRgb: { r: 255, g: 228, b: 211 }, canonicalRgb: { r: 255, g: 234, b: 211 } },
  { code: 'G18', hex: '#FFEAD6', printedRgb: { r: 255, g: 228, b: 214 }, canonicalRgb: { r: 255, g: 234, b: 214 } },
  { code: 'M3', hex: '#697E30', printedRgb: { r: 105, g: 126, b: 128 }, canonicalRgb: { r: 105, g: 126, b: 48 } },
] as const

export const PALETTE_MODES: readonly PaletteModeDefinition[] = [
  { id: 'standard', label: '48色 标准', shortLabel: '48色 标准', targetCount: 48 },
  { id: 'expert', label: '96色 专家', shortLabel: '96色 专家', targetCount: 96 },
  { id: 'complete', label: '221色 完整', shortLabel: '221色 完整', targetCount: 221 },
]

type ExistingPaletteSpec = Readonly<{
  code: string
  name: string
  hex: string
  groups: readonly string[]
}>

function canonicalPaletteCode(originalCode: string) {
  const match = originalCode.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/)
  if (!match) return originalCode.trim().toUpperCase()
  return `${match[1]}${match[2].padStart(2, '0')}`
}

const existingPaletteSpecs: readonly ExistingPaletteSpec[] = [
  { code: 'A01', name: '白色', hex: '#FFFFFF', groups: ['neutral', 'light'] },
  { code: 'A02', name: '象牙白', hex: '#F4EBD0', groups: ['neutral', 'light', 'warm'] },
  { code: 'A03', name: '浅灰', hex: '#C8CDD2', groups: ['neutral', 'light'] },
  { code: 'A04', name: '黑色', hex: '#22252A', groups: ['neutral', 'dark'] },
  { code: 'A05', name: '深灰', hex: '#626A72', groups: ['neutral', 'dark'] },
  { code: 'B01', name: '红色', hex: '#D9363E', groups: ['red', 'warm'] },
  { code: 'B02', name: '珊瑚红', hex: '#F26B5E', groups: ['red', 'warm'] },
  { code: 'B03', name: '橙色', hex: '#F28C28', groups: ['orange', 'warm'] },
  { code: 'B04', name: '黄色', hex: '#F5C542', groups: ['yellow', 'warm'] },
  { code: 'B05', name: '奶油黄', hex: '#FFE9A8', groups: ['yellow', 'light', 'warm'] },
  { code: 'C01', name: '草绿色', hex: '#65A85A', groups: ['green'] },
  { code: 'C02', name: '薄荷绿', hex: '#9DD9B5', groups: ['green', 'light'] },
  { code: 'C03', name: '青绿色', hex: '#2F9C95', groups: ['green', 'cyan'] },
  { code: 'C04', name: '天蓝色', hex: '#66B6E3', groups: ['blue', 'light'] },
  { code: 'C05', name: '湖蓝色', hex: '#2D7DB3', groups: ['blue'] },
  { code: 'C06', name: '深蓝色', hex: '#1D3F73', groups: ['blue', 'dark'] },
  { code: 'D01', name: '紫色', hex: '#7950A8', groups: ['purple'] },
  { code: 'D02', name: '薰衣草', hex: '#B9A4D6', groups: ['purple', 'light'] },
  { code: 'D03', name: '粉色', hex: '#E892B6', groups: ['pink'] },
  { code: 'D04', name: '棕色', hex: '#8B5E3C', groups: ['brown', 'warm'] },
  { code: 'D05', name: '沙色', hex: '#D6B98C', groups: ['brown', 'light', 'warm'] },
  { code: 'E01', name: '肤色', hex: '#F2C6A0', groups: ['skin', 'light', 'warm'] },
  { code: 'E02', name: '酒红', hex: '#7B2536', groups: ['red', 'dark'] },
  { code: 'E03', name: '荧光绿', hex: '#B7D53B', groups: ['green', 'bright'] },
]

type Mard221PaletteRow = readonly [
  originalCode: string,
  hex: string,
  r: number,
  g: number,
  b: number,
  L: number,
  a: number,
  labB: number,
]

/** MARD 221 rows transcribed from the supplied PDF, in PDF order. */
const mard221PaletteRows: readonly Mard221PaletteRow[] = [
  ['A1', '#FAF5CD', 250, 245, 205, 96.011943, -4.711383, 19.890239],
  ['A2', '#FCFED6', 252, 254, 214, 98.604467, -7.169912, 18.939847],
  ['A3', '#FCFF92', 252, 255, 146, 97.749034, -16.071594, 51.554740],
  ['A4', '#F7EC5C', 247, 236, 92, 91.925612, -13.051258, 68.779569],
  ['A5', '#FFE44B', 255, 228, 75, 90.438764, -6.710178, 74.023228],
  ['A6', '#FDA951', 253, 169, 81, 75.978737, 23.157976, 56.577912],
  ['A7', '#FA8C4F', 250, 140, 79, 69.215698, 36.892496, 49.973231],
  ['A8', '#F9E045', 249, 224, 69, 88.866077, -7.470858, 74.456212],
  ['A9', '#F99C5F', 249, 156, 95, 72.722277, 29.174174, 45.980330],
  ['A10', '#F47E36', 244, 126, 54, 65.295487, 40.537778, 57.317591],
  ['A11', '#FEDB99', 254, 219, 153, 88.938444, 3.376147, 36.935231],
  ['A12', '#FDA276', 253, 162, 118, 74.844675, 29.329837, 36.793179],
  ['A13', '#FEC667', 254, 198, 103, 83.145942, 9.782915, 54.412669],
  ['A14', '#F85842', 248, 88, 66, 59.277856, 59.911516, 45.490818],
  ['A15', '#FBF65E', 251, 246, 94, 94.835312, -16.194254, 71.150582],
  ['A16', '#FEFF97', 254, 255, 151, 97.963533, -14.811763, 49.472782],
  ['A17', '#FDE173', 253, 225, 115, 89.845819, -3.566696, 56.584763],
  ['A18', '#FCBF80', 252, 191, 128, 81.574164, 14.614449, 40.136418],
  ['A19', '#FD7E77', 253, 126, 119, 67.379137, 47.699090, 26.545525],
  ['A20', '#F9D66E', 249, 214, 110, 86.681347, 0.010373, 55.118701],
  ['A21', '#FAE393', 250, 227, 147, 90.491067, -2.882684, 41.892797],
  ['A22', '#EDF878', 237, 248, 120, 94.523760, -20.849944, 59.446126],
  ['A23', '#E1C9BD', 225, 201, 189, 82.622720, 6.480208, 9.053683],
  ['A24', '#F3F6A9', 243, 246, 169, 95.089648, -12.565690, 36.795994],
  ['A25', '#FFD785', 255, 215, 133, 87.753630, 3.833181, 45.466122],
  ['A26', '#FEC832', 254, 200, 50, 83.236583, 6.127995, 75.665043],
  ['B1', '#DFF139', 223, 241, 57, 91.186298, -26.925346, 79.709537],
  ['B2', '#64F343', 100, 243, 67, 85.612785, -68.615109, 69.076178],
  ['B3', '#9FF685', 159, 246, 133, 89.381713, -46.640682, 46.074862],
  ['B4', '#5FDF34', 95, 223, 52, 79.303309, -63.947281, 67.684648],
  ['B5', '#39E158', 57, 225, 88, 79.285365, -68.871454, 53.853045],
  ['B6', '#64B0A4', 100, 176, 164, 66.855006, -26.506568, -1.225449],
  ['B7', '#3FAE7C', 63, 174, 124, 63.985713, -43.341279, 16.593404],
  ['B8', '#1D9E54', 29, 158, 84, 57.419710, -50.323834, 29.315171],
  ['B9', '#2A5037', 42, 80, 55, 30.653325, -20.034911, 10.617805],
  ['B10', '#9AD1BA', 154, 209, 186, 79.622994, -22.499603, 5.687233],
  ['B11', '#627032', 98, 112, 50, 44.822727, -15.536662, 32.309879],
  ['B12', '#1A6E3D', 26, 110, 61, 40.748855, -36.590111, 20.429888],
  ['B13', '#C8E87D', 200, 232, 125, 87.714428, -26.938201, 48.349639],
  ['B14', '#ACE84C', 172, 232, 76, 85.506816, -41.653302, 66.719914],
  ['B15', '#305335', 48, 83, 53, 31.970108, -19.986959, 13.702431],
  ['B16', '#C0ED9C', 192, 237, 156, 89.005194, -28.453844, 34.637560],
  ['B17', '#9FB33E', 159, 179, 62, 69.440267, -23.041894, 55.244297],
  ['B18', '#E6ED4F', 230, 237, 79, 90.759767, -21.177435, 72.201385],
  ['B19', '#26B78E', 38, 183, 142, 66.696837, -46.621041, 10.455365],
  ['B20', '#CAEDCF', 202, 237, 207, 90.610761, -16.980849, 10.753259],
  ['B21', '#176268', 23, 98, 104, 37.693052, -19.682015, -9.863893],
  ['B22', '#0A4241', 10, 66, 65, 24.773222, -17.250129, -4.429498],
  ['B23', '#343B1A', 52, 59, 26, 23.447273, -9.144253, 19.339083],
  ['B24', '#E8FAA6', 232, 250, 166, 95.278795, -18.956383, 38.389537],
  ['B25', '#4E846D', 78, 132, 109, 50.950987, -23.562153, 6.831503],
  ['B26', '#907C35', 144, 124, 53, 52.510725, -1.157641, 40.665576],
  ['B27', '#D0E0AF', 208, 224, 175, 86.906713, -13.680268, 22.256050],
  ['B28', '#9EE5BB', 158, 229, 187, 85.451186, -30.751647, 13.507546],
  ['B29', '#C6DF5F', 198, 223, 95, 84.795731, -26.203169, 58.668844],
  ['B30', '#E3FBB1', 227, 251, 177, 95.370899, -19.840750, 32.959072],
  ['B31', '#B2F694', 178, 246, 148, 90.557956, -38.491888, 40.489977],
  ['B32', '#92AD60', 146, 173, 96, 67.158820, -22.188789, 36.418538],
  ['C1', '#FFFEE4', 255, 254, 228, 99.121452, -3.981364, 12.552514],
  ['C2', '#ABF8FE', 171, 248, 254, 92.991881, -22.050748, -10.413693],
  ['C3', '#9EE0F8', 158, 224, 248, 85.684272, -14.929709, -18.286236],
  ['C4', '#44CDFB', 68, 205, 251, 77.195025, -21.992985, -33.128412],
  ['C5', '#06ABE3', 6, 171, 227, 65.522718, -16.717430, -38.298602],
  ['C6', '#54A7E9', 84, 167, 233, 66.063115, -5.223588, -40.642970],
  ['C7', '#3977CC', 57, 119, 204, 50.005363, 8.784590, -49.866526],
  ['C8', '#0F52BD', 15, 82, 189, 37.499732, 22.984396, -61.423214],
  ['C9', '#3349C3', 51, 73, 195, 36.760171, 34.092511, -66.092280],
  ['C10', '#3DBBE3', 61, 187, 227, 70.925214, -21.279576, -29.864415],
  ['C11', '#2ADED3', 42, 222, 211, 80.425288, -44.608611, -6.910735],
  ['C12', '#1E334E', 30, 51, 78, 20.803638, 1.018565, -19.112500],
  ['C13', '#CDE7FE', 205, 231, 254, 90.453419, -3.813932, -13.995468],
  ['C14', '#D6FDFC', 214, 253, 252, 96.646299, -12.619582, -3.709220],
  ['C15', '#21C5C4', 33, 197, 196, 72.389527, -38.461938, -10.797944],
  ['C16', '#1858A2', 24, 88, 162, 37.448793, 8.674111, -45.529861],
  ['C17', '#02D1F3', 2, 209, 243, 77.331576, -30.735683, -28.701561],
  ['C18', '#213244', 33, 50, 68, 20.131361, -1.110951, -13.403714],
  ['C19', '#188690', 24, 134, 144, 50.987699, -25.085826, -13.725796],
  ['C20', '#1A70A9', 26, 112, 169, 45.182368, -3.605380, -37.349318],
  ['C21', '#BEDDFC', 190, 221, 252, 86.843773, -3.540272, -18.465368],
  ['C22', '#6BB1BB', 107, 177, 187, 68.136857, -19.393503, -12.023109],
  ['C23', '#C8E2F9', 200, 226, 249, 88.691157, -3.812324, -14.047682],
  ['C24', '#7EC5F9', 126, 197, 249, 76.804638, -8.399526, -32.500133],
  ['C25', '#A9E8E0', 169, 232, 224, 87.741897, -21.430187, -2.529472],
  ['C26', '#42ADD1', 66, 173, 209, 66.250736, -19.090780, -27.184304],
  ['C27', '#D0DEEF', 208, 222, 239, 87.912939, -1.337648, -9.894761],
  ['C28', '#BDCEED', 189, 206, 237, 82.419505, 0.712204, -17.194542],
  ['C29', '#364A89', 54, 74, 137, 32.892928, 12.722763, -37.620556],
  ['D1', '#ACB7EF', 172, 183, 239, 75.370146, 8.512930, -29.102325],
  ['D2', '#868DD3', 134, 141, 211, 60.623534, 14.322261, -36.767310],
  ['D3', '#3653AF', 54, 83, 175, 37.960496, 20.676434, -52.378616],
  ['D4', '#162C7E', 22, 44, 126, 21.865772, 24.100860, -48.680778],
  ['D5', '#B34EC6', 179, 78, 198, 50.815305, 58.045994, -44.519321],
  ['D6', '#B37BDC', 179, 123, 220, 60.708246, 39.605195, -41.386028],
  ['D7', '#8758A9', 135, 88, 169, 45.627234, 34.913208, -36.196555],
  ['D8', '#E3D2FE', 227, 210, 254, 86.790377, 14.024531, -19.340451],
  ['D9', '#D6BAF5', 214, 186, 245, 79.617532, 20.954783, -25.539757],
  ['D10', '#301A49', 48, 26, 73, 14.669603, 22.058517, -25.338712],
  ['D11', '#BCBAE2', 188, 186, 226, 76.860476, 8.744722, -19.695714],
  ['D12', '#DC99CE', 220, 153, 206, 71.183043, 33.273016, -17.082175],
  ['D13', '#B5038F', 181, 3, 143, 41.012041, 70.492099, -27.370636],
  ['D14', '#882893', 136, 40, 147, 35.710239, 54.211637, -38.721534],
  ['D15', '#2F1E8E', 47, 30, 142, 21.893267, 41.335886, -58.619882],
  ['D16', '#E2E4F0', 226, 228, 240, 90.755634, 1.546505, -6.064324],
  ['D17', '#C7D3F9', 199, 211, 249, 84.776705, 3.740351, -19.943301],
  ['D18', '#9A64B8', 154, 100, 184, 51.203890, 37.115492, -36.030542],
  ['D19', '#D8C2D9', 216, 194, 217, 80.845562, 11.801868, -8.634788],
  ['D20', '#9C34AD', 156, 52, 173, 42.063395, 58.943610, -44.044756],
  ['D21', '#940595', 148, 5, 149, 35.151536, 65.003022, -40.717980],
  ['D22', '#383995', 56, 57, 149, 29.252794, 28.705571, -50.850479],
  ['D23', '#FADBF8', 250, 219, 248, 90.672258, 15.609994, -10.171016],
  ['D24', '#768AE1', 118, 138, 225, 59.402061, 15.991139, -46.583975],
  ['D25', '#4950C2', 73, 80, 194, 39.662593, 32.385048, -60.723027],
  ['D26', '#D6C6EB', 214, 198, 235, 82.207743, 12.459248, -16.259861],
  ['E1', '#F6D4CB', 246, 212, 203, 87.480924, 10.448144, 8.820805],
  ['E2', '#FCC1DD', 252, 193, 221, 83.994831, 25.341794, -5.751629],
  ['E3', '#F6BDE8', 246, 189, 232, 82.814524, 27.256438, -13.455951],
  ['E4', '#E9639E', 233, 99, 158, 60.530110, 57.613580, -5.780750],
  ['E5', '#F1559F', 241, 85, 159, 59.617620, 66.004653, -7.580641],
  ['E6', '#BC4072', 188, 64, 114, 46.409303, 53.936985, -1.294337],
  ['E7', '#C63674', 198, 54, 116, 46.849676, 60.836614, -1.667714],
  ['E8', '#FDDBE9', 253, 219, 233, 90.518646, 14.027779, -2.495668],
  ['E9', '#E575C7', 229, 117, 199, 64.567033, 53.600771, -23.140938],
  ['E10', '#D33997', 211, 57, 151, 50.698324, 67.140360, -16.800900],
  ['E11', '#F7DAD4', 247, 218, 212, 89.238393, 9.065687, 6.615471],
  ['E12', '#F893BF', 248, 147, 191, 72.618110, 43.457804, -6.307804],
  ['E13', '#B5026A', 181, 2, 106, 39.424714, 66.596353, -6.803762],
  ['E14', '#FAD4BF', 250, 212, 191, 87.568772, 10.159475, 15.317981],
  ['E15', '#F5C9CA', 245, 201, 202, 84.715106, 15.697430, 5.363092],
  ['E16', '#FBF4EC', 251, 244, 236, 96.519764, 0.982736, 4.667001],
  ['E17', '#F7E3EC', 247, 227, 236, 92.028559, 8.339863, -1.911989],
  ['E18', '#FBCBDB', 251, 203, 219, 86.173971, 19.416343, -1.491373],
  ['E19', '#F6BBD1', 246, 187, 209, 81.694988, 24.519452, -2.770278],
  ['E20', '#D7C6CE', 215, 198, 206, 81.451546, 7.335333, -1.844895],
  ['E21', '#C09DA4', 192, 157, 164, 68.021164, 14.076704, 1.240526],
  ['E22', '#B58B9F', 181, 139, 159, 62.331820, 19.191164, -4.414193],
  ['E23', '#937D8A', 147, 125, 138, 54.767433, 10.794023, -3.892928],
  ['E24', '#DEBEE5', 222, 190, 229, 80.746379, 18.202268, -15.175049],
  ['F1', '#FF9280', 255, 146, 128, 71.809620, 39.212445, 27.517120],
  ['F2', '#F73D48', 247, 61, 72, 55.664322, 69.494952, 38.045546],
  ['F3', '#EF4D3E', 239, 77, 62, 56.094079, 61.175841, 43.689699],
  ['F4', '#F92B40', 249, 43, 64, 54.278259, 74.425496, 41.089472],
  ['F5', '#E30328', 227, 3, 40, 47.686956, 73.663407, 46.151527],
  ['F6', '#913635', 145, 54, 53, 35.820350, 38.404197, 20.869086],
  ['F7', '#911932', 145, 25, 50, 31.682042, 49.422227, 17.464595],
  ['F8', '#BB0126', 187, 1, 38, 39.115859, 64.001916, 35.959128],
  ['F9', '#B0677A', 176, 103, 122, 52.214705, 31.655764, 2.144174],
  ['F10', '#874628', 135, 70, 40, 37.269971, 25.096181, 30.031451],
  ['F11', '#6F321D', 111, 50, 29, 28.771262, 25.391039, 25.730895],
  ['F12', '#F8516D', 248, 81, 109, 58.923796, 65.051929, 20.796171],
  ['F13', '#F45C45', 244, 92, 69, 59.266660, 57.045084, 43.699648],
  ['F14', '#FCADB2', 252, 173, 178, 78.343180, 29.585669, 9.212400],
  ['F15', '#D50527', 213, 5, 39, 44.802831, 70.060248, 42.915518],
  ['F16', '#F8C0A9', 248, 192, 169, 82.120185, 16.956278, 19.312795],
  ['F17', '#E89B7D', 232, 155, 125, 70.925465, 25.424439, 27.473118],
  ['F18', '#D07E4A', 208, 126, 74, 60.627774, 27.095236, 41.244858],
  ['F19', '#BE454A', 190, 69, 74, 46.575497, 48.916682, 23.388170],
  ['F20', '#C69495', 198, 148, 149, 66.024513, 18.952682, 6.826034],
  ['F21', '#F2BBC6', 242, 187, 198, 81.013278, 21.407416, 2.108381],
  ['F22', '#F7C3D0', 247, 195, 208, 83.630614, 20.490105, 0.610518],
  ['F23', '#EC806D', 236, 128, 109, 65.259406, 39.648274, 28.877075],
  ['F24', '#E09DAF', 224, 157, 175, 71.593221, 27.505627, 0.729869],
  ['F25', '#E84854', 232, 72, 84, 54.480958, 61.929872, 29.062959],
  ['G1', '#FFEAD3', 255, 234, 211, 93.800657, 3.520980, 13.745032],
  ['G2', '#FCC6AC', 252, 198, 172, 83.998129, 15.694036, 20.383793],
  ['G3', '#F1C4A5', 241, 196, 165, 82.323469, 11.697215, 21.613445],
  ['G4', '#DCB387', 220, 179, 135, 75.578755, 8.914091, 28.066386],
  ['G5', '#E7B34E', 231, 179, 78, 75.933524, 8.570029, 57.184731],
  ['G6', '#F3A014', 243, 160, 20, 72.393153, 21.703254, 73.897437],
  ['G7', '#98503A', 152, 80, 58, 42.335553, 27.934426, 26.272694],
  ['G8', '#4B2B1C', 75, 43, 28, 21.235376, 13.059201, 15.963048],
  ['G9', '#E4B685', 228, 182, 133, 77.067077, 10.279740, 31.239933],
  ['G10', '#DA8C42', 218, 140, 66, 65.006158, 23.251994, 50.472616],
  ['G11', '#DAC898', 218, 200, 152, 81.005464, -0.877445, 26.337549],
  ['G12', '#FEC993', 254, 201, 147, 84.458327, 12.036379, 34.133620],
  ['G13', '#B2714B', 178, 113, 75, 53.796251, 21.783357, 31.585013],
  ['G14', '#8B684C', 139, 104, 76, 46.858032, 10.232366, 21.197142],
  ['G15', '#F6F8E3', 246, 248, 227, 96.932067, -4.226674, 9.850276],
  ['G16', '#F2D8C1', 242, 216, 193, 87.891150, 5.439170, 14.621290],
  ['G17', '#79544E', 121, 84, 78, 39.505679, 14.549394, 9.665506],
  ['G18', '#FFEAD6', 255, 234, 214, 93.866168, 3.969717, 12.283336],
  ['G19', '#DD7D41', 221, 125, 65, 62.015817, 32.411272, 47.828401],
  ['G20', '#A5452F', 165, 69, 47, 41.939327, 38.232437, 32.656419],
  ['G21', '#B38561', 179, 133, 97, 59.179096, 13.083055, 26.261256],
  ['H1', '#FBFBFB', 251, 251, 251, 98.618139, 0.005198, -0.010284],
  ['H2', '#FFFFFF', 255, 255, 255, 100.000000, 0.005260, -0.010408],
  ['H3', '#B4B4B4', 180, 180, 180, 73.312044, 0.004050, -0.008014],
  ['H4', '#878787', 135, 135, 135, 56.315465, 0.003279, -0.006489],
  ['H5', '#464648', 70, 70, 72, 29.788507, 0.448925, -1.204393],
  ['H6', '#2C2C2C', 44, 44, 44, 18.002903, 0.001542, -0.003051],
  ['H7', '#010101', 1, 1, 1, 0.274173, 0.000037, -0.000074],
  ['H8', '#E7D6DC', 231, 214, 220, 87.119024, 6.882409, -0.844262],
  ['H9', '#EFEDEE', 239, 237, 238, 93.922807, 0.849644, -0.256568],
  ['H10', '#ECEAEB', 236, 234, 235, 92.872694, 0.851630, -0.257055],
  ['H11', '#CDCDCD', 205, 205, 205, 82.405377, 0.004463, -0.008829],
  ['H12', '#FDF6EE', 253, 246, 238, 97.214299, 0.980751, 4.659592],
  ['H13', '#F4EFD1', 244, 239, 209, 94.127997, -3.227961, 15.119860],
  ['H14', '#CED7D4', 206, 215, 212, 85.238714, -3.588288, 0.412018],
  ['H15', '#98A6A6', 152, 166, 166, 67.052108, -4.907936, -1.694228],
  ['H16', '#1B1213', 27, 18, 19, 6.437233, 4.444567, 0.911358],
  ['H17', '#F0EEEF', 240, 238, 239, 94.272287, 0.848989, -0.256408],
  ['H18', '#FCFFF8', 252, 255, 248, 99.609218, -2.201420, 2.981930],
  ['H19', '#F2EEE5', 242, 238, 229, 94.176842, -0.202658, 4.813721],
  ['H20', '#96A09F', 150, 160, 159, 65.064714, -3.745292, -0.714230],
  ['H21', '#F8FBE6', 248, 251, 230, 97.898916, -4.559731, 9.712405],
  ['H22', '#CACADA', 202, 202, 218, 81.761800, 3.034029, -7.933299],
  ['H23', '#9B9C94', 155, 156, 148, 64.066560, -1.863461, 4.052070],
  ['M1', '#BBC6B6', 187, 198, 182, 78.653974, -6.715728, 6.712289],
  ['M2', '#909994', 144, 153, 148, 62.380699, -4.214711, 1.501139],
  ['M3', '#697E30', 105, 126, 48, 49.663503, -20.110233, 38.973470],
  ['M4', '#E0D4BC', 224, 212, 188, 85.283847, 0.213626, 13.357648],
  ['M5', '#D0CBAE', 208, 203, 174, 81.389208, -3.103567, 15.099939],
  ['M6', '#B0AA86', 176, 170, 134, 69.255884, -3.778722, 19.373486],
  ['M7', '#B0A796', 176, 167, 150, 68.801614, 0.307509, 9.949456],
  ['M8', '#AE8082', 174, 128, 130, 58.083265, 18.070046, 5.905412],
  ['M9', '#A88764', 168, 135, 100, 58.576875, 7.688440, 23.578671],
  ['M10', '#C6B2BB', 198, 178, 187, 74.466786, 8.722778, -1.970383],
  ['M11', '#9D7693', 157, 118, 147, 54.271825, 20.214119, -9.764059],
  ['M12', '#644B51', 100, 75, 81, 34.672180, 11.629468, 0.550182],
  ['M13', '#C79266', 199, 146, 102, 64.691146, 14.726737, 31.096327],
  ['M14', '#C37463', 195, 116, 99, 57.069318, 29.231649, 22.700291],
  ['M15', '#747D7A', 116, 125, 122, 51.593680, -3.960300, 0.475972],
]

const brandSeries: Record<BeadBrand, readonly string[]> = {
  MARD: ['221'],
  Perler: ['Standard'],
  Hama: ['Midi'],
  Artkal: ['S-Series'],
}

const LEGACY_MARD_SERIES = '291'
const DEFAULT_MARD_SERIES = '221'

function registryEntry(spec: ExistingPaletteSpec, brand = 'MARD', series = '291', code = spec.code): PaletteRegistryEntry {
  const rgb = hexToRgb(spec.hex)
  return {
    brand,
    brandCode: code,
    originalCode: code,
    displayCode: code,
    series,
    code,
    name: spec.name,
    hex: spec.hex.toUpperCase(),
    rgb,
    lab: rgbToLab(rgb),
    enabled: true,
    groups: [...spec.groups],
    source: 'existing',
  }
}

export const MARD_221_PALETTE_REGISTRY: readonly PaletteRegistryEntry[] = mard221PaletteRows.map(([originalCode, hex, r, g, b, L, a, labB]) => {
  const displayCode = canonicalPaletteCode(originalCode)
  return {
    brand: 'MARD',
    brandCode: originalCode,
    originalCode,
    displayCode,
    series: '221',
    code: displayCode,
    name: originalCode,
    hex,
    rgb: { r, g, b },
    lab: { L, a, b: labB },
    enabled: true,
    groups: [],
    source: 'verified',
  }
})

/** Single source of truth for the verified MARD/221 rows and legacy data. */
export const PALETTE_REGISTRY: readonly PaletteRegistryEntry[] = [
  ...existingPaletteSpecs.map((spec) => registryEntry(spec)),
  ...MARD_221_PALETTE_REGISTRY,
]

const paletteCache = new Map<string, BeadPaletteColor[]>()

export function isPaletteMode(value: unknown): value is BeadPaletteMode {
  return value === 'standard' || value === 'expert' || value === 'complete'
}

export function getPaletteModeDefinition(mode: BeadPaletteMode) {
  return PALETTE_MODES.find((item) => item.id === mode) || PALETTE_MODES[0]
}

function resolveBrandSeries(brand: string, series: string) {
  const safeBrand = (brand in brandSeries ? brand : 'MARD') as BeadBrand
  const seriesForBrand = getSeriesForBrand(safeBrand)
  // Keep an explicit legacy series resolvable so saved projects can still be
  // opened, while it is never returned as a selectable MARD option.
  const safeSeries = safeBrand === 'MARD' && series === LEGACY_MARD_SERIES
    ? LEGACY_MARD_SERIES
    : seriesForBrand.includes(series) ? series : seriesForBrand[0] || DEFAULT_MARD_SERIES
  return { safeBrand, safeSeries }
}

export function getPaletteCoverage(mode: BeadPaletteMode, brand = 'MARD', series = DEFAULT_MARD_SERIES) {
  const definition = getPaletteModeDefinition(mode)
  const entries = registryForBrand(brand, series)
  const available = entries.filter((entry) => entry.enabled).length
  const source = entries.some((entry) => entry.source === 'verified') ? MARD_221_SOURCE : PALETTE_SOURCE
  return { requested: definition.targetCount, available: Math.min(available, definition.targetCount), source }
}

function registryForBrand(brand: string, series: string) {
  const { safeBrand, safeSeries } = resolveBrandSeries(brand, series)
  if (safeBrand === 'MARD') return PALETTE_REGISTRY.filter((entry) => entry.brand === 'MARD' && entry.series === safeSeries)
  // Do not manufacture Perler/Hama/Artkal codes from the MARD rows. Until a
  // verified catalogue is added, every selectable row remains explicitly
  // tied to the existing MARD source and can be extended per brand later.
  return PALETTE_REGISTRY
    .filter((entry) => entry.brand === 'MARD' && entry.series === DEFAULT_MARD_SERIES)
}

function selectRepresentativeEntries(entries: readonly PaletteRegistryEntry[], target: number) {
  const enabled = entries.filter((entry) => entry.enabled)
  if (target >= enabled.length) return enabled
  if (target <= 0) return []

  // Keep useful neutral anchors in reduced palettes, then fill the remaining
  // slots with farthest-point sampling in Lab space. This gives deterministic
  // coverage of the 221-colour registry without changing image quantization.
  const anchorCodes = ['A01', 'A04', 'H2', 'H7']
  const selectedIndexes = new Set<number>()
  for (const code of anchorCodes) {
    const index = enabled.findIndex((entry) => entry.code === code)
    if (index >= 0 && selectedIndexes.size < target) selectedIndexes.add(index)
  }
  if (!selectedIndexes.size) selectedIndexes.add(0)

  while (selectedIndexes.size < target) {
    let bestIndex = -1
    let bestDistance = Number.NEGATIVE_INFINITY
    enabled.forEach((candidate, candidateIndex) => {
      if (selectedIndexes.has(candidateIndex)) return
      let nearestDistance = Number.POSITIVE_INFINITY
      selectedIndexes.forEach((selectedIndex) => {
        nearestDistance = Math.min(nearestDistance, deltaE76(candidate.lab, enabled[selectedIndex].lab))
      })
      if (nearestDistance > bestDistance) {
        bestDistance = nearestDistance
        bestIndex = candidateIndex
      }
    })
    if (bestIndex < 0) break
    selectedIndexes.add(bestIndex)
  }

  return enabled.filter((_, index) => selectedIndexes.has(index))
}

/** Return the complete registry or a deterministic representative subset. */
export function getPaletteRegistry(brand: string, series: string, mode: BeadPaletteMode = 'standard') {
  const target = getPaletteModeDefinition(mode).targetCount
  return selectRepresentativeEntries(registryForBrand(brand, series), target)
}

export function getPalette(brand: string, series: string, mode: BeadPaletteMode = 'standard') {
  const key = `${brand}:${series}:${mode}`
  const cached = paletteCache.get(key)
  if (cached) return cached
  const palette = getPaletteRegistry(brand, series, mode).map((entry) => ({
    brand: entry.brand,
    brandCode: entry.brandCode,
    originalCode: entry.originalCode,
    displayCode: entry.displayCode,
    series: entry.series,
    code: entry.code,
    name: entry.name,
    hex: entry.hex,
    rgb: { ...entry.rgb },
    lab: { ...entry.lab },
    enabled: entry.enabled,
    groups: [...entry.groups],
    source: entry.source,
  }))
  paletteCache.set(key, palette)
  return palette
}

export function normalizePaletteCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

function paletteCodeAliases(value: string) {
  const normalized = normalizePaletteCode(value)
  const match = normalized.match(/^([A-Z]+)(\d+)$/)
  if (!match) return [normalized]
  const digits = match[2].replace(/^0+(?=\d)/, '')
  return [...new Set([normalized, `${match[1]}${digits}`, `${match[1]}${digits.padStart(2, '0')}`])]
}

export function findPaletteColorByCode(palette: readonly BeadPaletteColor[], value: string) {
  const aliases = paletteCodeAliases(value)
  if (!aliases[0]) return null
  return palette.find((color) => [color.code, color.brandCode || '', color.originalCode || '', color.displayCode || '']
    .some((candidate) => aliases.includes(normalizePaletteCode(candidate)))) || null
}

export function getPaletteSourceNote(brand: string, series: string) {
  const { safeBrand, safeSeries } = resolveBrandSeries(brand, series)
  return safeBrand === 'MARD' && safeSeries === '221' ? MARD_221_SOURCE_NOTE : PALETTE_SOURCE_NOTE
}

export function getSeriesForBrand(brand: string) {
  return brandSeries[(brand in brandSeries ? brand : 'MARD') as BeadBrand] || []
}

export function getDefaultPalette() {
  return getPalette('MARD', DEFAULT_MARD_SERIES, 'standard')
}

/** Only verified palettes are exposed to the current editor UI. */
export const supportedBeadBrands: readonly BeadBrand[] = ['MARD']
