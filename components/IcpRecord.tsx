export const icpRecord = {
  number: '粤ICP备2026099247号-1',
  url: 'https://beian.miit.gov.cn',
} as const

export function IcpRecord({ inverse = false }: Readonly<{ inverse?: boolean }>) {
  return <a
    href={icpRecord.url}
    target="_blank"
    rel="noopener noreferrer"
    className={inverse ? 'icp-record icp-record-inverse' : 'icp-record'}
  >
    ICP备案号：{icpRecord.number}
  </a>
}
