'use client'

import useSWR, { mutate } from 'swr'
import { request } from './api'
import { useStudio } from './store'
import type { CreativeToolsSettings } from './creative-tool-showcase'

const prefix = 'oao-creative-tools:'
export function refreshCreativeTools() {
  return mutate(key => typeof key === 'string' && key.startsWith(prefix))
}
export function useCreativeTools() {
  const { state } = useStudio()
  const account = state.user?.id
  const { data, error, isLoading } = useSWR(account ? prefix + account : null,
    async () => (await request<{ creativeTools: CreativeToolsSettings }>('/api/creative-tools')).creativeTools,
    { fallbackData: state.sessionSettings?.creativeTools, revalidateOnFocus: true, dedupingInterval: 10000, keepPreviousData: false })
  return { settings: data ?? state.sessionSettings?.creativeTools, error, loading: Boolean(account && isLoading && !data) }
}
