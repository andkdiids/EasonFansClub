import React from 'react'
import Image from 'next/image'
import type { AndroidDownloadPageModel } from '@/lib/android-beta-download-page'
import { ANDROID_BETA_DOWNLOAD_PAGE_URL, formatAndroidApkSize, formatAndroidPublishedDate } from '@/lib/android-beta-download-page'
import { AndroidDownloadShareButton } from '@/components/app/AndroidDownloadShareButton'

export function AndroidDownloadPageContent({ model, qrDataUrl }: { model: AndroidDownloadPageModel; qrDataUrl: string | null }) {
  const manifest = model.status === 'available' ? model.manifest : null
  const size = manifest ? formatAndroidApkSize(manifest.size) : null
  const publishedDate = manifest ? formatAndroidPublishedDate(manifest.publishedAt) : null

  return (
    <main className="mx-auto min-h-[70vh] w-full max-w-5xl px-4 py-10 text-slate-900 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center gap-4">
          <Image src="/icon.png" alt="私家E院" width={56} height={56} className="h-14 w-14 rounded-2xl border border-slate-200 bg-white object-contain p-1" />
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-blue-700">ECFC · ANDROID</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">私家E院 Android 内测版</h1>
          </div>
        </header>

        <section aria-labelledby="download-version-heading" className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:mt-10 sm:p-8">
          {manifest ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">当前公开内测版本</p>
                  <h2 id="download-version-heading" className="mt-2 break-all text-2xl font-bold text-slate-950 sm:text-3xl">{manifest.versionName}</h2>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800">Android APK</span>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-3 border-y border-slate-100 py-4 text-sm sm:grid-cols-3">
                <div><dt className="text-slate-500">安装包大小</dt><dd className="mt-1 font-semibold text-slate-900">{size || '暂不可用'}</dd></div>
                <div><dt className="text-slate-500">版本号</dt><dd className="mt-1 font-semibold text-slate-900">{manifest.versionCode}</dd></div>
                {publishedDate ? <div><dt className="text-slate-500">发布时间</dt><dd className="mt-1 font-semibold text-slate-900"><time dateTime={manifest.publishedAt}>{publishedDate}</time></dd></div> : null}
              </dl>

              {manifest.releaseNotes.length ? (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-900">更新内容</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                    {manifest.releaseNotes.map((note, index) => <li key={`${index}-${note}`} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" /><span>{note}</span></li>)}
                  </ul>
                </div>
              ) : null}

              {model.visitor === 'ios' ? (
                <p className="mt-7 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">此安装包仅适用于 Android 设备。请使用 Android 手机访问本页下载。</p>
              ) : (
                <a href={manifest.downloadUrl} className="mt-7 flex min-h-14 w-full items-center justify-center rounded-2xl bg-blue-700 px-5 text-base font-bold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-800">
                  下载 Android 内测版
                </a>
              )}
              {model.visitor === 'wechat-android' && manifest ? <p className="mt-3 text-center text-xs leading-5 text-slate-500">如果微信内无法下载或安装，请从右上角菜单选择“在浏览器打开”。</p> : null}
            </>
          ) : (
            <div role="status" className="rounded-2xl bg-slate-50 p-5 text-sm leading-6 text-slate-700">
              <h2 id="download-version-heading" className="font-semibold text-slate-900">版本信息暂时不可用</h2>
              <p className="mt-2">请稍后重新打开本页。当前不会显示旧版本或未经确认的下载地址。</p>
            </div>
          )}

          <div className="mt-7 flex flex-col items-center gap-5 border-t border-slate-100 pt-6 sm:flex-row sm:justify-between">
            <AndroidDownloadShareButton url={ANDROID_BETA_DOWNLOAD_PAGE_URL} />
            {qrDataUrl ? (
              <figure className="flex items-center gap-3">
                <Image src={qrDataUrl} alt="扫描二维码打开私家E院 Android 下载页" width={104} height={104} unoptimized className="h-[104px] w-[104px] rounded-xl border border-slate-200 bg-white p-1" />
                <figcaption className="max-w-36 text-xs leading-5 text-slate-500">扫码打开本下载页<br />二维码不会直连存储地址</figcaption>
              </figure>
            ) : (
              <p className="text-xs text-slate-500">二维码暂不可用，请使用本页链接。</p>
            )}
          </div>
        </section>

        <p className="mt-5 break-all text-center text-xs text-slate-500">固定下载入口：{ANDROID_BETA_DOWNLOAD_PAGE_URL}</p>
      </div>
    </main>
  )
}
