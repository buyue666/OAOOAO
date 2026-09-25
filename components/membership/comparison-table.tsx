import { Fragment } from 'react'

import styles from './membership.module.css'
import type { GenerationColumn, GenerationRow } from './types'

const count = new Intl.NumberFormat('zh-CN')

interface ComparisonTableProps {
  columns: GenerationColumn[]
  rows: GenerationRow[]
}

export function ComparisonTable({ columns, rows }: ComparisonTableProps) {
  let previousGroup: GenerationRow['group'] | null = null

  return (
    <section className={styles.comparisonSection} aria-labelledby="comparison-title">
      <h2 id="comparison-title">每月生成数量</h2>
      <div className={styles.tableScroller} tabIndex={0} aria-label="会员生成量对比表，可横向滚动">
        <table>
          <thead>
            <tr>
              <th scope="col">模型</th>
              {columns.map((column) => <th scope="col" key={column.id}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const showGroup = previousGroup !== row.group
              previousGroup = row.group
              return (
                <Fragment key={row.name}>
                  {showGroup ? (
                    <tr className={styles.tableGroupRow}>
                      <th colSpan={columns.length + 1} scope="colgroup">
                        {row.group === 'video' ? '视频模型（单位：秒）' : '图片模型（单位：张）'}
                      </th>
                    </tr>
                  ) : null}
                  <tr>
                    <th scope="row">{row.name}</th>
                    {columns.map((column) => (
                      <td key={column.id}>{count.format(row.values[column.id])} {row.unit}</td>
                    ))}
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.tableNotice}>
        * 表中仅为明确配置的视觉演示样例；实际生成量受模型、分辨率与参数影响，不构成产量保证。
      </p>
    </section>
  )
}
