export type TeamRole = 'owner' | 'admin' | 'creator' | 'reviewer'
export const teamRoleLabels: Record<TeamRole, string> = { owner: '所有者', admin: '管理员', creator: '创作成员', reviewer: '审阅成员' }
export const isTeamManager = (role?: TeamRole) => role === 'owner' || role === 'admin'

export type TeamSummary = {
  id: string
  name: string
  role: TeamRole
  ownerId: string
  seatLimit: number
  occupiedSeats: number
  reservedSeats: number
  reviewerLimit: number
  reviewers: number
  reservedReviewers: number
  canDownload: boolean
  planName: string | null
  subscriptionExpiresAt: string | null
  transferTo: string | null
  transferExpiresAt: string | null
}
export type TeamMember = {
  userId: string
  name: string
  username: string
  role: TeamRole
  monthlyLimit: number | null
  spent: number
  canDownload: boolean
  joinedAt: string
}
export type TeamInvitation = { id: string; role: Exclude<TeamRole, 'owner'>; target: string | null; expiresAt: string; createdAt: string }
export type TeamProject = {
  id: string
  teamId: string
  title: string
  description: string
  visibility: 'team' | 'restricted'
  memberIds: string[]
  version: number
  updatedAt: string
  createdBy: string
  assetCount: number
}
export type TeamAsset = {
  id: string
  projectId: string
  title: string
  kind: 'text' | 'image' | 'video' | 'audio'
  bytes: number
  url: string
  createdBy: string
  creatorName: string
  createdAt: string
}
export type TeamUsage = {
  balance: number
  monthlySpent: number
  mySpent: number
  myLimit: number | null
  month: string
  storage: { usedBytes: number; quotaBytes: number; assets: number }
  batches: Array<{ id: string; source: string; remaining: number; expiresAt: string | null }>
  operations: Array<{ id: string; kind: 'grant' | 'debit' | 'refund'; amount: number; actorName: string; reason: string; createdAt: string }>
}
export type TeamEvent = { id: string; action: string; actorName: string; details: Record<string, unknown>; createdAt: string }
export type TeamPlan = {
  id: string
  name: string
  description: string
  enabled: boolean
  priceCents: number | null
  minSeats: number
  maxSeats: number
  reviewerLimit: number
  pointsPerSeat: number
  creditValidityDays: number
  storageBytes: number
  teamConcurrency: number
  memberConcurrency: number
  taskLimit: number
  modelIds: string[]
}
export const formatTeamBytes = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} GB` : `${(bytes / 1024 ** 2).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} MB`
export const teamNumber = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
