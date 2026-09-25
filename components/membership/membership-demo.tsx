'use client'

import { UserRound } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import {
  billingOptions,
  campaignBanner,
  faqItems,
  generationColumns,
  generationRows,
  membershipProducts,
} from './fixtures'
import { MembershipPurchaseView } from './membership-purchase-view'
import styles from './membership.module.css'

export function MembershipDemo() {
  const [isOpen, setIsOpen] = useState(true)

  if (!isOpen) {
    return (
      <main className={styles.closedState}>
        <Button size="lg" onClick={() => setIsOpen(true)}>
          <UserRound data-icon="inline-start" aria-hidden="true" />
          重新打开会员页
        </Button>
      </main>
    )
  }

  return (
    <MembershipPurchaseView
      products={membershipProducts}
      campaign={campaignBanner}
      billingOptions={billingOptions}
      generationColumns={generationColumns}
      generationRows={generationRows}
      faqItems={faqItems}
      onSelectPlan={() => undefined}
      onClose={() => setIsOpen(false)}
    />
  )
}
