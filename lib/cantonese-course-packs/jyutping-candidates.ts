import type { V6CoursePack } from './types'

export type JyutpingCandidate = {
  contentId: string
  candidate: string
  confidence: 'LOW' | 'MEDIUM'
  status: 'HUMAN_REVIEW_REQUIRED'
  ambiguousReason?: string
}

const candidate = (lesson: string, key: string, value: string, ambiguousReason?: string): JyutpingCandidate => ({
  contentId: `cantonese.v6.content.${lesson}.${key}`,
  candidate: value,
  confidence: ambiguousReason ? 'LOW' : 'MEDIUM',
  status: 'HUMAN_REVIEW_REQUIRED',
  ...(ambiguousReason ? { ambiguousReason } : {}),
})

/**
 * Editorial Jyutping candidates for the 80 older text rows with no reading.
 * These are explicit data values, never runtime transliteration. Every value
 * remains unapproved and must be checked against the Cantonese text by a human.
 */
export const V6_JYUTPING_CANDIDATES: readonly JyutpingCandidate[] = [
  candidate('lesson-05', 'thanks-contrast', 'm4 goi1 / do1 ze6'),
  candidate('lesson-05', 'how-lately', 'gan6 paai4 dim2 aa3'),
  candidate('lesson-05', 'im-good', 'ngo5 gei2 hou2 nei5 ne1'),
  candidate('lesson-05', 'excuse-question', 'm4 goi1 soeng2 man6 nei5 jat1 joeng6 je5'),
  candidate('lesson-05', 'gift-thanks', 'do1 ze6 nei5 sung3 bei2 ngo5'),
  candidate('lesson-05', 'bye', 'ngo5 zau2 sin1 laa3 haa6 ci3 gin3', '「喇」有口语变体；请确认目标口音和语境读法。'),
  candidate('lesson-05', 'd1a', 'zou2 san4 hou2 noi6 mou5 gin3'),
  candidate('lesson-05', 'd1b', 'hai6 aa3 gan6 paai4 dim2 aa3'),
  candidate('lesson-05', 'd1c', 'ngo5 gei2 hou2 nei5 ne1'),
  candidate('lesson-05', 'd1d', 'ngo5 dou1 gei2 hou2 dak1 haan4 zoi3 king1'),
  candidate('lesson-05', 'd2a', 'm4 goi1 ho2 m4 ho2 ji5 bong1 ngo5 hoi1 mun4'),
  candidate('lesson-05', 'd2b', 'dak1 mou5 man6 tai4'),
  candidate('lesson-05', 'd2d', 'm4 sai2 haak3 hei3'),
  candidate('lesson-05', 'd3a', 'deoi3 m4 zyu6 ngo5 mou5 lau4 ji3'),
  candidate('lesson-05', 'd3b', 'm4 gan2 jiu3 nei5 mou5 si6 aa3 maa3', '「吖嘛」口语粒子需由粤语审核员确认实际读法和写法。'),
  candidate('lesson-05', 'd3c', 'mou5 si6 do1 ze6 nei5'),
  candidate('lesson-05', 'd3d', 'gam2 zau6 hou2 baai1 baai3'),
  candidate('lesson-05', 'self-compare', 'm4 goi1 ho2 m4 ho2 ji5 bong1 ngo5 hoi1 mun4'),

  candidate('lesson-06', 'straight', 'jat1 zik6 haang4', '「行」在“步行”义读 haang4；仍请核对多音字及目标口音。'),
  candidate('lesson-06', 'left', 'zyun2 zo2', '方向语境的「轉」可能有异读；候选 zyun2，需人工裁定。'),
  candidate('lesson-06', 'right', 'zyun2 jau6', '方向语境的「轉」可能有异读；候选 zyun2，需人工裁定。'),
  candidate('lesson-06', 'cross', 'gwo3 maa5 lou6'),
  candidate('lesson-06', 'next-stop', 'haa6 jat1 zaam6'),
  candidate('lesson-06', 'where-station', 'm4 hou2 ji3 si3 dei6 tit3 zaam6 hai2 bin1 dou6'),
  candidate('lesson-06', 'how-go', 'cing2 man6 dim2 joeng2 heoi3 dei6 tit3 zaam6'),
  candidate('lesson-06', 'how-long', 'haang4 gwo3 heoi3 jiu3 gei2 noi6', '「行」在“步行”义读 haang4；请核对与「行過去」的连读。'),
  candidate('lesson-06', 'bus-go', 'ni1 gaa3 ce1 heoi3 m4 heoi3 wong6 gok3'),
  candidate('lesson-06', 'please-repeat', 'm4 goi1 ho2 m4 ho2 ji5 gong2 do1 ci3'),
  candidate('lesson-06', 'direction-contrast', 'hai2 bin1 dou6 / dim2 joeng2 heoi3'),
  candidate('lesson-06', 'junction-phrase', 'cin4 min6 go3 lou6 hau2'),
  candidate('lesson-06', 'd1a', 'm4 hou2 ji3 si3 dei6 tit3 zaam6 hai2 bin1 dou6'),
  candidate('lesson-06', 'd1b', 'jat1 zik6 haang4 cin4 min6 go3 lou6 hau2 zyun2 zo2', '「行」与方向义「轉」均需人工确认读音。'),
  candidate('lesson-06', 'd1c', 'hai6 m4 hai6 gwo3 zo2 maa5 lou6 zau6 dou3'),
  candidate('lesson-06', 'd1d', 'hai6 gwo3 zo2 maa5 lou6 zau6 gin3 dou3'),
  candidate('lesson-06', 'd1e', 'm4 goi1 saai3'),
  candidate('lesson-06', 'd2a', 'haang4 gwo3 heoi3 jiu3 gei2 noi6', '「行」在“步行”义读 haang4；请核对目标口音。'),
  candidate('lesson-06', 'd2b', 'daai6 koi3 sap6 fan1 zung1'),
  candidate('lesson-06', 'd2c', 'jat1 zik6 haang4 ding6 hai6 jiu3 zyun2 waan4', '「行」与方向义「轉」均需人工确认读音。'),
  candidate('lesson-06', 'd2d', 'haang4 dou3 go3 lou6 hau2 zyun2 jau6', '「行」与方向义「轉」均需人工确认读音。'),
  candidate('lesson-06', 'd3a', 'm4 goi1 ni1 gaa3 ce1 heoi3 m4 heoi3 wong6 gok3'),
  candidate('lesson-06', 'd3b', 'heoi3 nei5 ho2 ji5 soeng5 ce1'),
  candidate('lesson-06', 'd3c', 'cing2 man6 hai2 bin1 go3 zaam6 lok6 ce1'),
  candidate('lesson-06', 'd3d', 'ngo5 m4 ding6 nei5 tai2 haa5 ce1 soeng6 min6 ge3 zaam6 paai4'),
  candidate('lesson-06', 'd4a', 'm4 goi1 ho2 m4 ho2 ji5 gong2 do1 ci3'),
  candidate('lesson-06', 'd4b', 'jat1 zik6 haang4 dai6 ji6 go3 lou6 hau2 zyun2 zo2', '「行」與方向義「轉」均需人工確認讀音。'),
  candidate('lesson-06', 'd4c', 'dai6 ji6 go3 lou6 hau2 zyun2 zo2 hai6 m4 hai6', '方向義「轉」可能有異讀；候選 zyun2，需人工裁定。'),
  candidate('lesson-06', 'd4d', 'hai6 haang4 do1 zan6 zau6 dou3', '「行」在“步行”义读 haang4；请核对目标口音。'),

  candidate('lesson-07', 'dine-in', 'tong4 sik6'),
  candidate('lesson-07', 'takeaway', 'ngoi6 maai6'),
  candidate('lesson-07', 'take-away-action', 'ling1 zau2'),
  candidate('lesson-07', 'order', 'lok6 daan1'),
  candidate('lesson-07', 'less-ice', 'siu2 bing1'),
  candidate('lesson-07', 'less-sweet', 'siu2 tim4'),
  candidate('lesson-07', 'no-sweet', 'zau2 tim4'),
  candidate('lesson-07', 'sweetness-contrast', 'siu2 tim4 / zau2 tim4'),
  candidate('lesson-07', 'not-spicy', 'm4 jiu3 laat6'),
  candidate('lesson-07', 'two-people', 'loeng5 wai2 m4 goi1'),
  candidate('lesson-07', 'want-this', 'ngo5 soeng2 jiu3 ni1 go3'),
  candidate('lesson-07', 'order-drink', 'jat1 bui1 dung3 ning4 caa4 siu2 bing1 m4 goi1', '「檸」在原有条目中有不一致候选 ning2/ning4；请以可靠粤语词典和目标口音核对。'),
  candidate('lesson-07', 'spicy-check', 'ni1 go3 laat6 m4 laat6'),
  candidate('lesson-07', 'bill-please', 'm4 goi1 maai4 daan1'),
  candidate('lesson-07', 'ice-contrast', 'siu2 bing1 / zau2 bing1'),
  candidate('lesson-07', 'd1a', 'gei2 do1 wai2'),
  candidate('lesson-07', 'd1b', 'loeng5 wai2 m4 goi1'),
  candidate('lesson-07', 'd1c', 'tong4 sik6 ding6 ngoi6 maai6'),
  candidate('lesson-07', 'd1d', 'tong4 sik6 m4 goi1'),
  candidate('lesson-07', 'd2a', 'ngo5 soeng2 jiu3 ni1 go3 zung6 jau5 jat1 bui1 dung3 ning4 caa4', '「檸」在旧条目中已有不一致候选；请核对该字的读音。'),
  candidate('lesson-07', 'd2b', 'bui1 je5 jam2 jiu3 m4 jiu3 siu2 bing1'),
  candidate('lesson-07', 'd2c', 'siu2 bing1 zau6 dak1 m4 goi1'),
  candidate('lesson-07', 'd2d', 'hou2 zung6 jiu3 m4 jiu3 kei4 taa1 je5'),
  candidate('lesson-07', 'd2e', 'm4 goi1 ngo5 soeng2 gaa1 do1 jat1 fan6'),
  candidate('lesson-07', 'd3a', 'ni1 go3 laat6 m4 laat6'),
  candidate('lesson-07', 'd3b', 'jau5 siu2 siu2 laat6'),
  candidate('lesson-07', 'd3c', 'ho2 m4 ho2 ji5 m4 jiu3 laat6'),
  candidate('lesson-07', 'd3d', 'ngo5 bong1 nei5 man6 haa5 coeng4 fong2'),
  candidate('lesson-07', 'd4a', 'm4 goi1 maai4 daan1'),
  candidate('lesson-07', 'd4b', 'hou2 cing2 dang2 jat1 zan6'),
  candidate('lesson-07', 'd4c', 'ho2 m4 ho2 ji5 jung6 baat3 daat6 tung1'),
  candidate('lesson-07', 'd4d', 'ngo5 tai2 haa5 ni1 dou6 sau1 m4 sau1'),
  candidate('lesson-07', 'self-compare', 'm4 goi1 maai4 daan1'),
]

export const V6_JYUTPING_CANDIDATE_BY_ID = new Map(V6_JYUTPING_CANDIDATES.map((item) => [item.contentId, item]))

export function applyJyutpingCandidates(pack: V6CoursePack): V6CoursePack {
  const teaching = pack.teaching.map((item) => {
    const candidateItem = V6_JYUTPING_CANDIDATE_BY_ID.get(item.externalId)
    return candidateItem ? { ...item, jyutping: candidateItem.candidate, jyutpingReviewStatus: 'JYUTPING_REVIEW_REQUIRED' as const } : item
  })
  const jyutpingByContentId = new Map(teaching.map((item) => [item.externalId, item.jyutping || '']))
  const audio = pack.audio.map((item) => ({ ...item, jyutping: jyutpingByContentId.get(item.contentId) || item.jyutping }))
  return { ...pack, teaching, audio }
}
