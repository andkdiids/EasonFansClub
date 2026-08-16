export function normalizeWantListenTitle(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[.,，。!?！？:：;；、·・•'"“”‘’`~～_\-—–/\\()[\]{}<>《》〈〉【】]/gu, '')
    .trim()
}
