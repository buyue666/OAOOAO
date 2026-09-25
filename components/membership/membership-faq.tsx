'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import styles from './membership.module.css'
import type { FaqItem } from './types'

export function MembershipFaq({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className={styles.faqSection} aria-labelledby="faq-title">
      <h2 id="faq-title">常见问题</h2>
      <div className={styles.faqList}>
        {items.map((item, index) => {
          const isOpen = openIndex === index
          return (
            <article className={styles.faqItem} key={item.question}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${index}`}
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                <span>{item.question}</span>
                <ChevronDown aria-hidden="true" />
              </button>
              {isOpen ? (
                <p id={`faq-answer-${index}`}>
                  {item.answer ?? '该政策正文尚未配置，请以正式购买页公示内容为准。'}
                </p>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
