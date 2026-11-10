import type { FastifyInstance } from 'fastify';
import { httpError, type Context } from './core.js';
import { creativeReferenceRow } from './creative-reference-store.js';
import { downloadObjectUrl, getObject } from './object-storage.js';

function view(row: Record<string, any>) {
  return { id: row.id, role: row.role, groupId: row.group_id, title: row.title,
    category: row.category, style: row.style, angle: row.angle, tags: row.tags,
    url: `/api/creative-references/${row.id}/content`, thumbnailUrl: `/api/creative-references/${row.id}/thumbnail`,
    attribution: String(row.metadata?.attribution || ''), source: 'catalog' };
}
export async function registerCreativeReferences(app: FastifyInstance, ctx: Context) {
  app.get('/api/creative-references', async request => {
    await ctx.requireUser(request);
    const q = request.query as Record<string, string>, role = q.role || 'garment';
    if (!['person','garment','pose'].includes(role)) throw httpError(400, '无效的素材类型');
    for (const key of ['keyword','category','style','angle']) if ((q[key]?.length || 0) > 120) throw httpError(400, '筛选条件过长');
    const page = Math.max(1, Math.min(10000, Number(q.page) || 1)) | 0;
    const pageSize = Math.max(1, Math.min(60, Number(q.pageSize) || 36)) | 0;
    const grouped = role === 'pose' && q.grouped !== 'false';
    const values = [role, (q.keyword || '').trim().replace(/[\\%_]/g, '\\$&'), q.category || '', q.style || '', q.angle || ''];
    const where = `enabled AND role=$1 AND ($2='' OR title ILIKE '%'||$2||'%' OR id ILIKE '%'||$2||'%' OR tags::text ILIKE '%'||$2||'%') AND ($3='' OR category=$3) AND ($4='' OR style=$4) AND ($5='' OR angle=$5)`;
    const selection = grouped ? `SELECT DISTINCT ON (group_id) * FROM oaooao_creative_references WHERE ${where} ORDER BY group_id,CASE angle WHEN '正面' THEN 0 ELSE 1 END,id` : `SELECT * FROM oaooao_creative_references WHERE ${where}`;
    const rows = (await ctx.db.query(`SELECT * FROM (${selection}) chosen ORDER BY group_id,id LIMIT $6 OFFSET $7`, [...values, pageSize, (page-1)*pageSize])).rows;
    const total = Number((await ctx.db.query(`SELECT count(*) total FROM (${selection}) chosen`, values)).rows[0].total);
    const facets = (await ctx.db.query('SELECT category,style,angle,count(*)::int count FROM oaooao_creative_references WHERE enabled AND role=$1 GROUP BY category,style,angle', [role])).rows;
    const variants = grouped && rows.length ? (await ctx.db.query('SELECT id,group_id,role,title,category,style,angle,tags,metadata FROM oaooao_creative_references WHERE enabled AND role=$1 AND group_id=ANY($2::text[]) ORDER BY CASE angle WHEN \'正面\' THEN 0 ELSE 1 END,id', [role, rows.map(row=>row.group_id)])).rows : [];
    return { items: rows.map(row=>({ ...view(row), ...(grouped ? { variants: variants.filter(v=>v.group_id===row.group_id).map(view) } : {}) })), total, page, pageSize, grouped,
      categories: [...new Set(facets.map(row=>row.category).filter(Boolean))], styles: [...new Set(facets.map(row=>row.style).filter(Boolean))], angles: [...new Set(facets.map(row=>row.angle).filter(Boolean))] };
  });
  for (const part of ['content','thumbnail']) app.get(`/api/creative-references/:id/${part}`, async (request, reply) => {
    await ctx.requireUser(request);
    const row = await creativeReferenceRow(ctx, (request.params as {id:string}).id);
    const location = part === 'thumbnail' ? row.thumbnail_location : row.storage_location;
    reply.header('Cache-Control','private, max-age=180');
    if (location.provider !== 'vercel-blob') return reply.redirect(await downloadObjectUrl(ctx, location, 600));
    return reply.type(part === 'thumbnail' ? row.thumbnail_mime_type : row.mime_type).send(await getObject(ctx,location));
  });
}
