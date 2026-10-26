export type RecordingSessionsShowSeed = {
  date: string
  startTime: string
  albumTitle: string
  albumYear: number | null
  songs: string[]
  note: string | null
}

export const recordingSessionsEventSeed = {
  title: 'Recording Sessions',
  subtitle: 'Recording Sessions with Mr. Eason Chan',
  slug: 'recording-sessions',
  venue: '香港演艺学院 Lyric 剧院',
  startDate: '2026-12-12',
  endDate: '2027-02-20',
  description: '以專輯與歌單為線索，記錄 26 場 Recording Sessions。演出資料及曲目整理自用户提供的本地参考页面，尚未独立核实；场次、曲目与票务安排请以主办方最新公告为准。',
  sourceNote: '内容来源：用户提供的 cityline-tutorial.html（本地参考文件，未独立核验）。私家E院是粉丝社区专题，不代表 Cityline、主办方或场地方。',
  timezone: 'Asia/Hong_Kong',
  registrationUrl: 'https://cultural.cityline.com/sc/2026/baleasonregchan.html',
  registrationEnabled: true,
  registrationLabel: '登记入口',
  homepageFeatured: true,
  activityCenterVisible: true,
  allowMarking: true,
  allowDiscussion: true,
  status: 'UPCOMING' as const,
}

export const recordingSessionsTimelineSeed = [
  { id: 'recording-sessions-registration-open', type: 'REGISTRATION_OPEN', title: '登记抽签开放', date: '2026-10-28', startsAt: '2026-10-28T11:00:00+08:00', endsAt: null, sortOrder: 10, countdownEnabled: true },
  { id: 'recording-sessions-registration-close', type: 'REGISTRATION_CLOSE', title: '登记抽签截止', date: '2026-10-29', startsAt: null, endsAt: '2026-10-29T23:59:00+08:00', sortOrder: 20, countdownEnabled: true },
  { id: 'recording-sessions-first-draw', type: 'FIRST_DRAW_RESULT', title: '首轮抽签结果', date: '2026-11-02', startsAt: null, endsAt: null, sortOrder: 30, countdownEnabled: false },
  { id: 'recording-sessions-first-payment', type: 'FIRST_PAYMENT_DEADLINE', title: '首轮付款截止', date: '2026-11-05', startsAt: null, endsAt: null, sortOrder: 40, countdownEnabled: false },
  { id: 'recording-sessions-second-draw', type: 'SECOND_DRAW_RESULT', title: '次轮抽签结果', date: '2026-11-06', startsAt: null, endsAt: null, sortOrder: 50, countdownEnabled: false },
  { id: 'recording-sessions-second-payment', type: 'SECOND_PAYMENT_DEADLINE', title: '次轮付款截止', date: '2026-11-09', startsAt: null, endsAt: null, sortOrder: 60, countdownEnabled: false },
  { id: 'recording-sessions-first-show', type: 'FIRST_SHOW', title: 'Recording Sessions 首场', date: '2026-12-12', startsAt: null, endsAt: null, sortOrder: 70, countdownEnabled: false },
  { id: 'recording-sessions-final-show', type: 'FINAL_SHOW', title: 'Recording Sessions 最终场', date: '2027-02-20', startsAt: null, endsAt: null, sortOrder: 80, countdownEnabled: false },
] as const

export const recordingSessionsTutorialSeed = [
  {
    id: 'recording-sessions-registration-guide',
    type: 'REGISTRATION' as const,
    title: '登记抽签步骤',
    summary: '这是私家E院整理的用户参考资料。报名和账号操作均在外部登记服务完成；请以该服务的最新页面说明为准。',
    status: 'PUBLISHED' as const,
    sortOrder: 10,
    steps: [
      { title: '先准备账号', body: '按参考资料提示，提前准备好外部登记服务账号。私家E院不会收集你的外部账号密码。' },
      { title: '查看登记时间与官方须知', body: '页面显示的日期和规则来自用户提供的参考文件，尚未独立核实；提交前请在外部登记页面再次确认。' },
      { title: '打开登记入口并填写资料', body: '通过本页后台配置的外部登记入口完成操作。请自行在外部服务输入资料，不要把证件、联系方式或支付资料发到社区。' },
      { title: '保存确认编号并等待结果', body: '参考资料提示提交后应留存确认编号。抽签结果和后续安排请查看外部服务的最新通知；本专题不代为查询或处理票务账号。' },
    ],
  },
  {
    id: 'recording-sessions-ticketing-guide',
    type: 'TICKETING' as const,
    title: '中签后付款与抢票教程',
    summary: '当前参考文件没有提供可完整核实的付款与购票操作流程。内容待管理员补充并审核。',
    status: 'DRAFT' as const,
    sortOrder: 20,
    steps: [],
  },
]

export const recordingSessionsShowsSeed: RecordingSessionsShowSeed[] = [
  { date: '2026-12-12', startTime: '20:00', albumTitle: '《陳奕迅》', albumYear: 1996, songs: ['时代曲', '伤信', '游离份子', '我怕你不肯', '有意无意', '安守本分', '爱情·幼稚', '从未痴心', '其实我记得（与杨千嬅合唱）', '当心中有恋爱感觉'], note: null },
  { date: '2026-12-13', startTime: '20:00', albumTitle: '《與我常在》', albumYear: 1998, songs: ['现场直播', '与我常在', '没有左右', '生命有几好', '拥抱这分钟', '那一夜没有雪？', '伴游', '跟我走好吗', '今天等我来', '故人', '那一夜有没有说'], note: null },
  { date: '2026-12-16', startTime: '20:00', albumTitle: '《I Had A Great Time!》', albumYear: 2004, songs: ['24', '万佛朝宗', '一切还好', '冤气', '八里公路', '放下来', '爱你入骨', '最后今晚', '不求人', '开不了心'], note: null },
  { date: '2026-12-17', startTime: '20:00', albumTitle: '《The Easy Ride》', albumYear: 2001, songs: ['阿士匹灵', '阳性反应', '冲口而出', '大开眼戒', '我不好爱', '热带雨林', '人工智能', '结束开始', '活着多好', '他一个人', '不知所谓'], note: null },
  { date: '2026-12-19', startTime: '20:00', albumTitle: '《H³M》', albumYear: 2009, songs: ['Allegro Opus 3.3am', '还有什么可以送给你', '于心有愧', '今天只做一件事', '一个旅人', '七百年后', 'Life Goes On', '太阳照常升起', '不来也不去', '沙龙'], note: null },
  { date: '2026-12-20', startTime: '20:00', albumTitle: '《Taste the Atmosphere》；《Stranger Under My Skin》', albumYear: null, songs: ['Welcome to the Future', '讲男讲女', '叶问风中转', '花花世界', '我杯茶（与莫文蔚合唱）', '蜃楼', 'My Private Christmas Song', '苦瓜', '六月飞霜', 'Stranger Under My Skin', '沼气', '最后派对', '等你爱我', '因为爱情', '乐园'], note: null },
  { date: '2026-12-23', startTime: '20:00', albumTitle: '《不想放手》', albumYear: 2008, songs: ['路…一直都在', '不要说话', '七', '绑带人生', "Aren't You Glad?", '土星环', '漂亮小姐', '独居动物', '臭美', '然后怎样'], note: null },
  { date: '2026-12-24', startTime: '20:00', albumTitle: '《4 A Change & Hits》；《幸福》；《新生活》', albumYear: null, songs: ['King Kong', 'Lonely Christmas', '第一类接触', '少见不怪', '幸福摩天轮', '垃圾', '时光倒流二十年', '非走不可', '忽然难过', '有了你', '春光乍泄', '改造人', '飘飘飘', '专家话', '超人的主题曲+屎捞人', '终于一百日', '新生活', '游移的伤口', '地狱咒', '天一半，地一半', '回绝', '美满人生'], note: '圣诞前夜' },
  { date: '2026-12-26', startTime: '20:00', albumTitle: '《黑·白·灰》', albumYear: 2003, songs: ['阿怪', '我们都寂寞', '兄妹', '十年', '要你的', '世界', '谢谢', '像一句广告', '寂寞奏鸣曲', 'Last Order'], note: '圣诞节后' },
  { date: '2026-12-27', startTime: '20:00', albumTitle: '《Special Thanks To…》', albumYear: 2002, songs: ['Special Thanks To 1', 'Special Thanks To 2', 'Special Thanks To 3', '人造卫星', '你会不会', '你的背包', '想哭', '没有手机的日记', '狂人日记', '男人的错', '谢谢侬', '跳蚤市场', '故事'], note: null },
  { date: '2027-01-06', startTime: '20:00', albumTitle: "《What's Going On...?》", albumYear: 2006, songs: ['裙下之臣', '最后的嬉皮士', '白玫瑰', '黑择明', '富士山下', '不如不见', '心深伤透', '解药', '天公地道', '粤语残片'], note: null },
  { date: '2027-01-07', startTime: '20:00', albumTitle: '《認了吧》', albumYear: 2007, songs: ['烟味', '淘汰', '快乐男生', '红玫瑰', '月黑风高', '爱情转移', '好久不见', '爱是一本书', '第一个雅皮士', '白色球鞋'], note: null },
  { date: '2027-01-09', startTime: '20:00', albumTitle: '《Life Continues...》；《Time Flies》', albumYear: null, songs: ['低调', '车志', '最佳损友', '暴殄天物', '落花流水', '大得太快', '想听', '无人之境', '大人', '一丝不挂', '陀飞轮', '心腹', '味之素'], note: null },
  { date: '2027-01-10', startTime: '20:00', albumTitle: '《Solidays》', albumYear: 2008, songs: ['新曲：歌·颂', '后台（另精选收录：K歌之王 / 十年 / 单车 / 富士山下 / 浮夸等粤语国语代表作）'], note: null },
  { date: '2027-01-23', startTime: '20:00', albumTitle: '《天佑爱人》', albumYear: 1999, songs: ['昨日', '今日', '每一个明天', '眼眉调', '一', '第五个现代化', '快高长大', '如果这一秒钟你跟我讲你不爱我', '我的世界末日', '贝多芬与我'], note: null },
  { date: '2027-01-24', startTime: '20:00', albumTitle: '《Listen To Eason Chan》', albumYear: 2007, songs: ['玛利奥派对', '热岛小夜曲', '闪', '演唱会', '滑铁卢车站', 'Crying in the Party', '狂热', '变色龙', '时代巨轮', '乜嘢啫', '兄弟（国）（与刘德华合唱）'], note: null },
  { date: '2027-01-27', startTime: '20:00', albumTitle: '《Nothing Really Matters》', albumYear: 2000, songs: ['Made In Hong Kong', '黑夜不再来', '美丽有罪', '戏迷情人', '和平饭店', '我感激', '到此一游', '当这地球没有花', '爱上你是我眼睛的错'], note: null },
  { date: '2027-01-28', startTime: '20:00', albumTitle: '《怎麼樣》', albumYear: 2005, songs: ['不能再等待', '对不起谢谢', 'Hippie', '不然你要我怎么样', '不睡', '一夜销魂', '浮城', '早开的长途班', '听听（粤）', '人神斗（粤）'], note: null },
  { date: '2027-01-30', startTime: '20:00', albumTitle: '《The Line-Up》', albumYear: 2002, songs: ['心里有鬼', '我有我爱你', '明年今日', '人来人往', '季军', '随意门', '1874', '防不胜防', '两名男子街头相遇', '黑面'], note: null },
  { date: '2027-01-31', startTime: '20:00', albumTitle: '《Live For Today》', albumYear: 2003, songs: ['幸灾乐祸', 'Katrina', '十面埋伏', '吔边个边个', '小孩不懂怕', '真相', '谎言', '猜情寻', '忘记歌词', 'New Order', '岁月如歌'], note: null },
  { date: '2027-02-12', startTime: '20:00', albumTitle: '《打得火熱》', albumYear: 2000, songs: ['K歌之王', '打得火热', '新广告歌', '低等动物', '绵绵', '美丽谎言', '吹微风', '温室效应', '活跃症', '下周同样时间'], note: '春节假期内（以官方安排为准）' },
  { date: '2027-02-13', startTime: '20:00', albumTitle: '《It\'s Me 反正是我》', albumYear: 2001, songs: ['Good Times', 'K歌之王（国）', '爱是怀疑', '不如这样', '低等动物', '没有你', '全世界失眠', '我也不会那么做', '冤家'], note: '春节假期内（以官方安排为准）' },
  { date: '2027-02-16', startTime: '20:00', albumTitle: '《上五楼的快活》', albumYear: 2009, songs: ['在你身边', '这样的一个麻烦', '多少', 'Nothing Ever Happened', '你为什么哭了呢', '谋情害命', '我甲你', '心的距离', '床头灯', '给你', '从何说起'], note: null },
  { date: '2027-02-17', startTime: '20:00', albumTitle: '《我的快樂時代》', albumYear: 1998, songs: ['我的快乐时代', '我什么都没有', '天下无双', '黄金时代', '新曲+精选', '愈想愈无谓', '相信相依', '两种讲法', '请相信我', '反高潮', '多一点'], note: null },
  { date: '2027-02-19', startTime: '20:00', albumTitle: '《Shall We Dance? Shall We Talk!》', albumYear: 2001, songs: ["Eason's Angel", 'Shall We Talk', 'Shall We Dance', '单车', '孤独探戈', '怪物', '黑暗中漫舞', '伤心花舍', '失恋太少', '太空漫游', '天使的礼物'], note: null },
  { date: '2027-02-20', startTime: '20:00', albumTitle: '《U87》', albumYear: 2005, songs: ['葡萄成熟时', '遇见了你（国）', '浮夸', '夕阳无限好', '16月6日晴', '怕死', '三个人的探戈', '烂', '不良嗜好', '新美人主义（国）', '阿牛', '大个女'], note: '元宵节' },
]
