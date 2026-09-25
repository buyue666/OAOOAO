/**
 * 账户数据刷新协调器：任务完成 → 作品/素材/余额/账户数据一起更新。
 *
 * 背景（本轮复现的真实缺陷）：
 *  - 任务卡已经显示「已完成」，但结果舞台、作品列表、素材库、账户余额仍是旧的，
 *    必须刷新页面才恢复。根因是各数据源各读各的：
 *    任务来自 `generation-store`，作品/历史/流水来自 `use-account-data` 的 hooks，
 *    余额来自 `store` 的会话快照，彼此没有触发关系。
 *  - 各 hooks 只用 `activeRef` 布尔值防竞态。布尔值在**快速切换账号**时会失效：
 *    A 的请求在 cleanup 后仍未返回，切回 A 时新一轮请求把 `activeRef` 重新置为 true，
 *    于是**旧的那次响应**回来时 `activeRef.current === true`，就把 A 的旧数据
 *    覆盖到已经更新的界面上。
 *
 * 这里用「单调自增世代 + 订阅」解决两件事：
 *  1. 任何数据源都可以 `bumpAccountData()`，所有订阅者一起重新读取；
 *  2. 每个订阅者带自己的世代号，回调时比对；**过期的响应一律丢弃**。
 */

export type AccountDataEpoch = number

type Listener = (epoch: AccountDataEpoch) => void

/**
 * 账户数据世代。
 *
 * 用模块级单例而不是 React state：它需要在多个 Provider/hook 之间共享，
 * 且必须在**同步**路径上可读（异步回调里要用它判断是否过期）。
 */
let currentEpoch = 0
const listeners = new Set<Listener>()

export function accountDataEpoch(): AccountDataEpoch {
  return currentEpoch
}

/**
 * 标记账户数据已变化，通知所有订阅者重新读取。
 *
 * 调用场景：任务进入终态、生成结果写入、素材上传完成、项目成员变化、
 * 账号切换（切换会同时让旧世代失效）。
 */
export function bumpAccountData(): AccountDataEpoch {
  currentEpoch += 1
  for (const listener of [...listeners]) {
    try {
      listener(currentEpoch)
    } catch {
      // 单个订阅者抛错不能影响其它订阅者，也不能让调用方失败。
    }
  }
  return currentEpoch
}

export function subscribeAccountData(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * 生成一个「只写最新一次请求结果」的守卫。
 *
 * 用法：
 * ```ts
 * const guard = createWriteGuard()
 * useEffect(() => {
 *   const token = guard.begin()          // 取本次请求的令牌
 *   void load().then((data) => {
 *     if (!guard.isCurrent(token)) return // 过期响应直接丢弃
 *     setData(data)
 *   })
 * }, [deps])
 * ```
 *
 * 与 `activeRef` 的区别：令牌是**每次请求独立**的，因此
 * 「A 请求 → 切账号 → 切回 → 新 A 请求 → 旧 A 响应返回」这种交错
 * 也会被正确丢弃（旧令牌已被新令牌取代，且世代已变化）。
 */
export function createWriteGuard() {
  let issued = 0
  let epochAtIssue = currentEpoch
  return {
    /** 开始一次请求，返回本次请求的令牌。 */
    begin(explicitEpoch: AccountDataEpoch = currentEpoch) {
      issued += 1
      epochAtIssue = explicitEpoch
      return { id: issued, epoch: explicitEpoch }
    },
    /** 该令牌是否仍然有效：既要是最新一次请求，也不能跨账户世代。 */
    isCurrent(token: { id: number; epoch: AccountDataEpoch }) {
      return token.id === issued && token.epoch === currentEpoch
    },
    /** 主动作废在途请求（卸载、账号切换时调用）。 */
    invalidate() {
      issued += 1
    },
  }
}

/** 测试/验收辅助：重置协调器状态。 */
export function resetAccountDataForTests() {
  currentEpoch = 0
  listeners.clear()
}
