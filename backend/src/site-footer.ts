import { httpError } from './core.js';

type FooterLink = {label:string;url:string};
export type SiteFooter = {showOnStudio:boolean;description:string;copyrightHolder:string;registrationLabel:string;registrationUrl:string;contactEmail:string;contactUrl:string;socialLinks:FooterLink[];productLinks:FooterLink[]};
export const DEFAULT_SITE_FOOTER:SiteFooter={showOnStudio:false,description:'把想法变成画面、镜头与故事。为下一次灵感，留一片自由的空间。',copyrightHolder:'',registrationLabel:'',registrationUrl:'',contactEmail:'siyuesy@gmail.com',contactUrl:'',socialLinks:[],productLinks:[{label:'图片生成',url:'/image'},{label:'视频生成',url:'/video'},{label:'自由画布',url:'/canvas'},{label:'创作助手',url:'/agent'},{label:'积分超市',url:'/credits'}]};
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
export function footerUrl(value:unknown):string {
  if(typeof value!=='string'||/[\\\u0000-\u001f\u007f-\u009f]/u.test(value))throw httpError(400,'Invalid footer URL');
  const text=value.trim();if(!text)return '';if(text.length>2048)throw httpError(400,'Footer URL exceeds 2048 characters');
  if(text.startsWith('/')&&!text.startsWith('//'))return text;
  if(!/^https?:\/\/[^/\s]/i.test(text))throw httpError(400,'Invalid footer URL');
  let url:URL;try{url=new URL(text);}catch{throw httpError(400,'Invalid footer URL');}
  const authority=text.slice(text.indexOf('://')+3).split(/[/?#]/,1)[0];
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||authority.includes('@')||url.username||url.password||url.href.length>2048)throw httpError(400,'Invalid footer URL');
  return text;
}
function footerText(value:unknown,maximum:number,name:string):string {if(typeof value!=='string'||value.length>maximum||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value))throw httpError(400,`Invalid footer ${name}`);return value.trim();}
function footerEmail(value:unknown):string {const email=footerText(value,254,'email');if(email&&!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email))throw httpError(400,'Invalid footer email');return email;}
function footerLinks(value:unknown):FooterLink[]{if(!Array.isArray(value)||value.length>8)throw httpError(400,'Footer links must contain at most 8 entries');return value.map(raw=>{const row=record(raw);if(Object.keys(row).some(key=>!['label','url'].includes(key)))throw httpError(400,'Unknown footer link field');const label=footerText(row.label,40,'link label'),url=footerUrl(row.url);if(!label||!url)throw httpError(400,'Footer links require a label and URL');return {label,url};});}
export function validateSiteFooter(value:unknown):SiteFooter {
  const input=record(value);if(value===null||typeof value!=='object'||Array.isArray(value))throw httpError(400,'Invalid footer settings');
  if(Object.keys(input).some(key=>!Object.hasOwn(DEFAULT_SITE_FOOTER,key)))throw httpError(400,'Unknown footer field');
  const data={...DEFAULT_SITE_FOOTER,...input};if(typeof data.showOnStudio!=='boolean')throw httpError(400,'Invalid footer visibility');
  return {showOnStudio:data.showOnStudio,description:footerText(data.description,500,'description'),copyrightHolder:footerText(data.copyrightHolder,160,'copyright holder'),registrationLabel:footerText(data.registrationLabel,160,'registration label'),registrationUrl:footerUrl(data.registrationUrl),contactEmail:footerEmail(data.contactEmail),contactUrl:footerUrl(data.contactUrl),socialLinks:footerLinks(data.socialLinks),productLinks:footerLinks(data.productLinks)};
}
/** Public reads never turn malformed legacy settings into active links. */
export function publicSiteFooter(value:unknown):SiteFooter {
  const input=record(value),output=structuredClone(DEFAULT_SITE_FOOTER);
  for(const key of Object.keys(output) as (keyof SiteFooter)[]){
    if(!Object.hasOwn(input,key))continue;
    try{Object.assign(output,{[key]:validateSiteFooter({[key]:input[key]})[key]});}
    catch{Object.assign(output,{[key]:key==='socialLinks'||key==='productLinks'?[]:key==='showOnStudio'?false:''});}
  }
  return output;
}
export function publicSite(value:unknown){const site={...record(value)};delete site.announcementBar;site.footer=publicSiteFooter(site.footer);return site;}
