'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from './api'
import { subscribeAccountData } from './account-data-sync'
import { useStudio } from './store'

export type StorageUsage = { usedBytes:number; quotaBytes:number; remainingBytes:number|null; unlimited:boolean; files:number; pendingDeletionBytes:number; planName:string|null }
export type StoredMedia = { id:string; url:string; mimeType:string; bytes:number; persistent:boolean; createdAt:string; expiresAt?:string }
export function formatStorageBytes(bytes:number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)),4)
  return `${(bytes / 1024 ** index).toLocaleString('zh-CN',{maximumFractionDigits:index?1:0})} ${['B','KB','MB','GB','TB'][index]}`
}
export function mediaIdFromUrl(raw?:string):string|null {
  if(!raw)return null
  try { const url=new URL(raw,typeof window==='undefined'?'http://localhost':window.location.origin);if(typeof window!=='undefined'&&url.origin!==window.location.origin)return null;return /^\/api\/(?:media|reference-assets|generation-log-assets)\/([a-f0-9-]{36})$/i.exec(url.pathname)?.[1]||null }catch{return null}
}
export function deleteAccountAssets(input:{mediaIds:string[];libraryIds:string[];externalUrls?:string[]}) {
  return request<{deletedMediaIds:string[];deletedExternalUrls:string[];skipped:Array<{id:string;reason:string}>;freedBytes:number;storage:StorageUsage}>('/api/account/assets/batch-delete',{method:'POST',body:JSON.stringify(input)})
}
export function useStorageUsage() {
  const {state}=useStudio(),account=state.user.id,connected=state.backendStatus==='connected'
  const [snapshot,setSnapshot]=useState<{account:string;data:StorageUsage}|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    if(!connected)return
    let stopped=false,epoch=0
    const load=async()=>{const n=++epoch;try{const data=await request<StorageUsage>('/api/account/storage');if(!stopped&&n===epoch){setSnapshot({account,data});setError('')}}catch(e){if(!stopped&&n===epoch)setError(e instanceof Error?e.message:'容量读取失败')}}
    void load();const off=subscribeAccountData(()=>void load()),timer=setInterval(()=>void load(),60000)
    return()=>{stopped=true;off();clearInterval(timer)}
  },[account,connected])
  return {usage:connected&&snapshot?.account===account?snapshot.data:null,error:connected?error:''}
}
export function useStoredMedia() {
  const {state}=useStudio(),account=state.user.id,connected=state.backendStatus==='connected'
  const [snapshot,setSnapshot]=useState<{account:string;items:StoredMedia[];total:number;page:number}>({account:'',items:[],total:0,page:0})
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),epoch=useRef(0)
  const fetchPage=useCallback(async(page:number)=>{
    const n=++epoch.current
    setLoading(true)
    try {const data=await request<{media:StoredMedia[];total:number}>(`/api/account/stored-media?page=${page}&pageSize=100`);if(n===epoch.current){setSnapshot(old=>({account,items:page===1?data.media:[...(old.account===account?old.items:[]),...data.media],total:data.total,page}));setError('')}}catch(e){if(n===epoch.current)setError(e instanceof Error?e.message:'存储文件读取失败')}finally{if(n===epoch.current)setLoading(false)}
  },[account])
  useEffect(()=>{if(!connected)return;void fetchPage(1);const off=subscribeAccountData(()=>void fetchPage(1));return()=>{epoch.current++;off()}},[fetchPage,connected])
  const current=connected&&snapshot.account===account
  return {media:current?snapshot.items:[],hasMore:current&&snapshot.items.length<snapshot.total,loading,error,loadMore:()=>!loading&&fetchPage(snapshot.page+1)}
}
