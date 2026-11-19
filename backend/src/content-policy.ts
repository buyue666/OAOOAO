import type { PoolClient } from 'pg';
import { httpError, iso, type Context } from './core.js';

export const ADULT_CONTENT_POLICY_VERSION = 'adult-content-v2-20261117';
export const ADULT_CONTENT_AGREEMENT = {
  title: '成人内容使用约定',
  sections: [
    { title: '年龄与使用资格', text: '我声明已满 18 周岁，且达到所在地适用的成年年龄。未成年人不得开启、查看或使用成人内容功能，也不得借用他人账号访问。此声明不代表平台已完成身份或年龄核验。' },
    { title: '未成年人保护', text: '严禁制作、上传、引用、生成、传播任何涉及未成年人或疑似未成年人的色情、性暗示、裸露、性化、剥削内容；包括虚构、动漫、合成、换脸，以及将未成年人形象“成年化”后用于此类内容。无法确认人物成年时，不得用于成人内容。' },
    { title: '真实人物与同意', text: '仅可使用拥有合法使用权且已取得相关成年当事人明确同意的素材。禁止未经同意的色情换脸、私密影像、偷拍、性化真人形象、性骚扰、勒索或侵害隐私、肖像及其他权利的内容。' },
    { title: '禁止的内容与行为', text: '禁止性暴力、胁迫、人口贩运、性剥削及其他违法或侵权内容。禁止绕过年龄限制、素材权限、模型或上游服务的内容限制，不得把本功能提供给未成年人。开启此功能不代表可以生成或传播违法淫秽色情内容。' },
    { title: '模型限制与发布责任', text: '成人内容模式只允许调用管理员明确授权的模型；未授权模型会停止提供给本账号使用。授权不代表上游保证接受请求，仍须遵守模型服务条款、所在地法律及发布平台规则。分享前应标记内容性质、限制未成年人访问，并履行适用的 AI 内容标识义务。' },
    { title: '操作记录与留存', text: '平台会记录生成操作及必要的安全审计信息，相关记录保留不少于六个月，用于安全审查、投诉处理与违规追溯。记录仅限经授权的人员依照职责访问。记录留存不代表生成文件永久保存；文件仍受存储容量与清理规则限制。' },
    { title: '关闭、更新与处理', text: '可以随时关闭成人内容模式，关闭后成人素材会隐藏，普通模型恢复可用；已生成或已下载的文件不会自动删除。平台会保存协议版本、同意时间及设置变更记录。协议更新后须重新同意；违反约定时，平台可限制相关功能、移除内容或暂停账号。' },
  ],
} as const;

export async function adultContentPreference(ctx: Context, userId?: string, client?: PoolClient) {
  const row = userId ? (await (client || ctx.db).query('SELECT * FROM oaooao_content_preferences WHERE user_id=$1', [userId])).rows[0] : undefined;
  return {
    enabled: row?.adult_enabled === true && row.acknowledged_policy_version === ADULT_CONTENT_POLICY_VERSION && Boolean(row.age_declared_at),
    policyVersion: ADULT_CONTENT_POLICY_VERSION,
    acknowledgedAt: iso(row?.age_declared_at) ?? null,
  };
}

export function assertAdultModelAllowed(adultEnabled: boolean, model: Record<string, any>) {
  if (adultEnabled && model.allowAdultContent !== true)
    throw httpError(403, `成人内容模式已开启，模型「${model.name || model.id}」未获准用于成人内容。请更换允许的模型，或在账户菜单关闭成人内容后使用。`);
}
