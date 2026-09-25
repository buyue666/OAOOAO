import Image from 'next/image'

import styles from './membership.module.css'
import type { CampaignBannerConfig } from './types'

export function CampaignBanner({ campaign }: { campaign: CampaignBannerConfig }) {
  return (
    <section className={styles.campaignBanner} aria-label="会员活动">
      <Image
        src={campaign.imageSrc}
        alt={campaign.imageAlt}
        fill
        priority
        sizes="(max-width: 760px) 100vw, 920px"
      />
      <div className={styles.campaignCopy}>
        <strong>{campaign.title}</strong>
        <span>{campaign.subtitle}</span>
      </div>
    </section>
  )
}
