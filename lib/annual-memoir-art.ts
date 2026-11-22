export const memoirChapters = ['初次见面', '日子有功', '有话好说', '最佳损友', '念念不忘', '游戏人间', '闪闪发光', '我们万岁', '年度身份', '明年今日'] as const

export type MemoirAlbum = {
  nickname: string; uid: number; registered: string
  communityMemory?: { kind: 'POST' | 'REPLY'; excerpt: string; date: string } | null
  bestGame?: { score: number; mode: string } | null
  monthlyFirsts?: number | null; weeklyFirsts?: number | null
  activeDays?: number; checkIns?: number; checkInExperience?: number; posts?: number; replies?: number
  likesGiven?: number; likesReceived?: number; friends?: number; games?: number; bestScore?: number | null
  badges?: number; featuredBadge?: string | null; featuredBadgeDate?: string | null; longestCheckInRun?: number
  topics?: number; offlineMeetups?: number; title: string; message: string
}

const W = 1080
const H = 1920
const sans = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif'
const serif = '"Songti SC","Noto Serif CJK SC",SimSun,"Microsoft YaHei",serif'
const tones = [
  ['#faefd9','#cfa49d','#421e37'], ['#432c4e','#8d4f64','#fff4dc'],
  ['#f4dece','#cda39f','#462035'], ['#3d293e','#744349','#fff0df'],
  ['#f2e3c8','#b88f99','#4e253b'], ['#382941','#805169','#fff3e1'],
  ['#e9d7bb','#b79492','#452137'], ['#f6e6cf','#bc8993','#4f283d'],
  ['#48283d','#905667','#fff2dd'], ['#382137','#7a3d54','#fff1dc'],
]
const reflections = [
  '故事从这里开始。', '那些普通的日子，也有自己的重量。', '每一次开口，都给这一年留下了回声。',
  '有些相遇，慢慢走成了同行。', '回头看时，那一刻还在那里。', '在熟悉的旋律里，听见自己的节奏。',
  '把闪过的光，郑重收藏。', '有些时刻，是我们一起抵达的。', '用一个词，把这一年的自己留住。', '',
]
const number = (value?: number | null) => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN').format(value!) : '—'
const memoryLabel = (kind: 'POST' | 'REPLY') => kind === 'POST' ? '你写下的一篇帖子' : '你留下的一条评论'
const memoryEmpty = '有些想说的话，正等着被写下来。'
const bestGame = (r: MemoirAlbum) => r.bestGame === undefined && typeof r.bestScore === 'number'
  ? { score: r.bestScore, mode: '听听' }
  : r.bestGame
const date = (value?: string | null) => {
  const parts = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return parts ? parts[1] + ' 年 ' + Number(parts[2]) + ' 月 ' + Number(parts[3]) + ' 日' : value || '暂无日期记录'
}

export function describeMemoirPage(r: MemoirAlbum, i: number): string {
  return [
    [r.nickname, 'UID ' + r.uid, date(r.registered) + '加入私家E院'],
    ['活跃 ' + number(r.activeDays) + ' 天', '挂号 ' + number(r.checkIns) + ' 天', number(r.checkInExperience) + ' 挂号经验', r.longestCheckInRun !== undefined ? '最长连续挂号 ' + number(r.longestCheckInRun) + ' 天' : ''],
    [number(r.posts) + ' 篇公开帖子', number(r.replies) + ' 条公开评论', '送出 ' + number(r.likesGiven) + ' 赞', '收到 ' + number(r.likesReceived) + ' 赞'],
    [number(r.friends) + ' 段新友谊'],
    [r.communityMemory ? [memoryLabel(r.communityMemory.kind), r.communityMemory.excerpt, date(r.communityMemory.date)].join('。') : memoryEmpty],
    ['最高单局分数 ' + number(bestGame(r)?.score), bestGame(r)?.mode, '月度第一 ' + number(r.monthlyFirsts), '周度第一 ' + number(r.weeklyFirsts)],
    [number(r.badges) + ' 枚获得的勋章', r.featuredBadge, r.featuredBadgeDate && date(r.featuredBadgeDate)],
    ['参与过的话题活动 ' + number(r.topics) + ' 场', '和大家线下见面 ' + number(r.offlineMeetups) + ' 次'],
    [r.title, number(r.activeDays) + ' 个活跃日'],
    [r.nickname, r.title, r.message],
  ][i].concat(reflections[i]).filter(Boolean).join('。')
}

export function drawMemoirPage(canvas: HTMLCanvasElement, r: MemoirAlbum, year: number, page: number) {
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')
  if (!c) throw new Error('CANVAS_UNAVAILABLE')
  const [base, shade, ink] = tones[page]
  const dark = [1,3,5,8,9].includes(page)
  const gold = dark ? '#e5bd8c' : '#8b5b55'
  const x0 = 105
  const text = (value: string, x: number, y: number, size: number, max = 870, display = false, color = ink) => {
    c.fillStyle = color
    c.textAlign = 'left'
    c.font = (display ? '600 ' : '400 ') + size + 'px ' + (display ? serif : sans)
    const width = c.measureText(value).width
    if (width > max) c.font = (display ? '600 ' : '400 ') + Math.floor(size * max / width) + 'px ' + (display ? serif : sans)
    c.fillText(value, x, y, max)
  }
  const lines = (value: string, x: number, y: number, size: number, max: number, limit: number, display = false) => {
    c.font = (display ? '600 ' : '400 ') + size + 'px ' + (display ? serif : sans)
    if (display && c.measureText(value).width > max * limit * 0.95) {
      size = Math.max(34, Math.floor(size * max * limit * 0.95 / c.measureText(value).width))
      c.font = '600 ' + size + 'px ' + serif
    }
    const rows: string[] = []
    let row = ''
    for (const char of Array.from(value)) {
      if (row && c.measureText(row + char).width > max) { rows.push(row); row = '' }
      row += char
    }
    if (row) rows.push(row)
    if (rows.length > limit) {
      rows.length = limit
      rows[limit - 1] = Array.from(rows[limit - 1]).slice(0, -1).join('') + '…'
    }
    rows.forEach((line, i) => text(line, x, y + i * size * 1.28, size, max, display))
  }
  const rect = (x: number, y: number, w: number, h: number, color: string | CanvasGradient, radius = 0) => {
    c.fillStyle = color; c.beginPath(); c.roundRect(x,y,w,h,radius); c.fill()
  }
  const line = (x: number, y: number, x2: number, y2: number, color = gold) => {
    c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); c.moveTo(x,y); c.lineTo(x2,y2); c.stroke()
  }
  const ellipse = (x: number,y: number,rx: number,ry: number,color: string | CanvasGradient,outline = false) => {
    c.beginPath(); c.ellipse(x,y,rx,ry,0,0,Math.PI*2)
    if (outline) { c.strokeStyle=color; c.lineWidth=2; c.stroke() }
    else { c.fillStyle=color; c.fill() }
  }
  const mist = (x: number,y: number,radius: number,color: string) => {
    const g=c.createRadialGradient(x,y,0,x,y,radius); g.addColorStop(0,color); g.addColorStop(1,'transparent')
    rect(0,0,W,H,g)
  }
  const backdrop = c.createLinearGradient(100,0,950,H)
  backdrop.addColorStop(0,base); backdrop.addColorStop(.71,shade); backdrop.addColorStop(1,base)
  c.fillStyle=backdrop; c.fillRect(0,0,W,H)
  mist(page % 2 ? 780 : 180, 345, 700, dark ? '#c6898f60' : '#fff9e9df')
  mist(page % 2 ? 170 : 930, 1260, 810, dark ? '#26213cab' : '#7d496738')
  c.strokeStyle=gold+'75'; c.lineWidth=2; c.strokeRect(52,56,976,1808)
  const panel = dark ? '#271a3090' : '#fff4dfbd'
  const title = (x = x0, y = 370, size = 105) => text(memoirChapters[page],x,y,size,920-x,true)
  const stat = (value: number | null | undefined, label: string, x: number, y: number, size = 150, width = 760) => {
    text(number(value),x,y,size,width,true); text(label,x,y+76,43,width)
  }
  const vine = (x: number,y: number,scale: number) => {
    c.save(); c.translate(x,y); c.scale(scale,scale)
    c.strokeStyle=gold+'72'; c.lineWidth=3
    c.beginPath(); c.moveTo(-210,230); c.bezierCurveTo(90,210,-180,-140,115,-290); c.bezierCurveTo(310,-420,365,-110,170,-130); c.stroke()
    for (const [a,b,s] of [[-90,-65,75],[40,-30,99],[145,35,80],[-42,90,89],[60,125,77],[10,220,60]]) {
      const g=c.createRadialGradient(a-s*.25,b-s*.35,0,a,b,s); g.addColorStop(0,gold+'85'); g.addColorStop(1,shade+'25')
      ellipse(a,b,s,s,g)
      ellipse(a,b,s,s,gold+'65',true)
    }
    c.restore()
  }
  text('私家E院  /  ' + year + ' 年度回忆录',x0,145,35,870,false,gold)
  line(x0,184,975,184,gold+'75')
  switch (page) {
    case 0:
      vine(764,768,1.68)
      title(x0,386,114)
      text('相遇这一页',x0,478,48)
      rect(89,1002,893,502,panel,12)
      lines(r.nickname || '私家E院的朋友',132,1127,75,812,2,true)
      line(132,1260,921,1260)
      text('UID ' + r.uid,132,1340,51)
      text(date(r.registered) + '加入私家E院',132,1431,43,790)
      break
    case 1:
      title(x0,348)
      for(let i=0;i<4;i++) ellipse(770,789,135+i*55,225+i*44,gold+'42',true)
      line(132,485,132,1470,gold+'94')
      for(const y of [590,1085,1370]) ellipse(132,y,10,10,gold)
      stat(r.activeDays,'留下社区记录的天数',190,754,235,770)
      stat(r.checkIns,'挂号天数',190,1142,130,345)
      stat(r.checkInExperience,'挂号经验',560,1335,130,390)
      if (r.longestCheckInRun !== undefined) text('最长连续挂号 '+number(r.longestCheckInRun)+' 天',190,1560,42,740)
      break
    case 2:
      title(122,355)
      c.save(); c.translate(110,490); c.rotate(-.075); rect(0,0,845,498,panel,20); c.restore()
      rect(138,562,790,425,'#fff3e5aa',14)
      line(195,650,858,650,gold+'65'); stat(r.posts,'公开帖子',195,848,150,660)
      rect(258,1050,708,465,'#70394bdb',15)
      text(number(r.replies),302,1223,125,580,true,'#fff4df')
      text('公开评论',302,1290,44,540,false,'#fff4df')
      text('送出 '+number(r.likesGiven)+' 赞  ·  收到 '+number(r.likesReceived)+' 赞',302,1421,40,615,false,'#fff4df')
      break
    case 3:
      title(162,390)
      ellipse(406,840,278,288,gold+'60',true)
      ellipse(675,1050,273,288,gold+'78',true)
      ellipse(430,862,200,200,'#a568884c')
      ellipse(667,1035,185,185,'#e2a38d36')
      line(197,1220,884,716,gold+'65')
      rect(176,1110,742,380,panel,18)
      stat(r.friends,'这一年结下的新友谊',230,1340,160,630)
      break
    case 4: {
      const memory = r.communityMemory
      title(140,359)
      c.save(); c.translate(132,533); c.rotate(-.047)
      rect(0,0,834,922,'#fff4dc',6)
      rect(29,31,776,848,'#f5e4d1',4)
      line(88,204,720,204,gold)
      text(memory ? memoryLabel(memory.kind) : '留给未来的一页',88,153,43,658,true)
      lines(memory ? memory.excerpt : memoryEmpty,88,350,48,658,8,true)
      if (memory) text(date(memory.date),88,796,38,655)
      c.restore()
      break
    }
    case 5: {
      const game = bestGame(r)
      title(x0,345)
      rect(125,513,830,522,panel,16)
      stat(game?.score,'最高单局分数',182,799,185,710)
      text(game?.mode ?? '暂无有效成绩',182,965,40,710)
      rect(125,1110,396,346,panel,14)
      rect(555,1110,400,346,panel,14)
      line(163,1160,480,1160,gold)
      line(593,1160,916,1160,gold)
      stat(r.monthlyFirsts,'月度第一',163,1330,110,320)
      stat(r.weeklyFirsts,'周度第一',593,1330,110,320)
      break
    }
    case 6:
      title(148,351)
      rect(154,490,772,928,panel,365)
      for(const radius of [270,234,184]) ellipse(540,936,radius,radius,gold+'88',true)
      ellipse(540,936,156,156,'#aa76574a')
      ellipse(540,936,96,96,'#ebc49276')
      line(270,1270,813,1270)
      if (r.featuredBadge) text(r.featuredBadge,238,1213,46,620,true)
      if (r.featuredBadgeDate) text(date(r.featuredBadgeDate),238,1259,32,620)
      stat(r.badges,'这一年获得的勋章',207,1505,143,635)
      break
    case 7:
      title(x0,345)
      rect(94,510,891,981,panel,28)
      rect(112,529,854,940,'#fff6e4b8',20)
      for(let x=150;x<930;x+=38) line(x,1010,x+18,1010,gold)
      ellipse(102,1010,21,21,shade); ellipse(979,1010,21,21,shade)
      stat(r.topics,'参与过的话题活动 · 场',156,790,157,742)
      stat(r.offlineMeetups,'和大家线下见面 · 次',156,1270,140,742)
      break
    case 8:
      title(142,390)
      rect(134,529,811,954,panel,32)
      c.strokeStyle=gold+'ac'; c.lineWidth=2; c.strokeRect(159,554,761,902)
      vine(786,787,.87)
      text('年度关键词',190,720,41,650,false,gold)
      lines(r.title || '故事刚刚开始',190,1108,92,684,2,true)
      line(191,1280,885,1280)
      text(number(r.activeDays)+' 个活跃日',192,1390,47,680)
      break
    case 9:
      vine(722,735,2.02)
      title(117,394,124)
      rect(102,1025,876,660,panel,18)
      lines(r.nickname || '私家E院的朋友',144,1143,69,780,2,true)
      text(r.title || '故事刚刚开始',144,1315,48,780,false,gold)
      line(145,1370,932,1370,gold+'85')
      lines(r.message || '等到葡萄成熟时，才发现这一年，原来已经这么甜。',144,1470,55,780,3,true)
      break
  }
  if (reflections[page]) lines(reflections[page],x0,1710,47,880,2,true)
  line(x0,1782,975,1782,gold+'80')
  text('葡萄成熟时',x0,1823,31,870,false,gold)
}
