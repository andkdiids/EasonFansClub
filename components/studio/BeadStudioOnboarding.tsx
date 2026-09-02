'use client'

import { UiIcon } from '@/components/UiIcon'
import styles from './studio.module.css'

const STEPS = [
  { number: '01', title: '上传图片', description: '选择喜欢的照片、插画或图案。' },
  { number: '02', title: '调整参数', description: '选择尺寸、比例和颜色模式。' },
  { number: '03', title: '生成图纸', description: '编辑颜色、查看材料并开始制作。' },
] as const

export function BeadStudioOnboarding({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  return (
    <aside className={styles.onboardingCard} role="dialog" aria-modal="false" aria-labelledby="bead-studio-onboarding-title" aria-describedby="bead-studio-onboarding-description">
      <div className={styles.onboardingHeader}>
        <span className={styles.onboardingEyebrow}>BEAD STUDIO / START</span>
        <button type="button" className={styles.onboardingClose} onClick={onDismiss} aria-label="关闭首次使用引导">×</button>
      </div>
      <h2 id="bead-studio-onboarding-title" className={styles.onboardingTitle}>欢迎来到贝多芬与我</h2>
      <p id="bead-studio-onboarding-description" className={styles.onboardingSubtitle}>把喜欢的图片，做成专属拼豆图纸。</p>
      <ol className={styles.onboardingSteps}>
        {STEPS.map((step) => <li key={step.number} className={styles.onboardingStep}><span className={styles.onboardingStepNumber}>{step.number}</span><span className={styles.onboardingStepCopy}><strong>{step.title}</strong><small>{step.description}</small></span></li>)}
      </ol>
      <div className={styles.onboardingActions}>
        <button type="button" className={styles.actionButton} onClick={onDismiss}>以后再看</button>
        <button type="button" className={`${styles.actionButton} ${styles.actionButtonPrimary}`} onClick={onDismiss}><UiIcon name="brush" />开始创作</button>
      </div>
    </aside>
  )
}
