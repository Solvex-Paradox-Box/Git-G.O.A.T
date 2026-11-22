import { randomUUID } from 'node:crypto';
import { Finding, RULES, ScanReport, Severity, WEIGHTS } from '../shared/contracts.js';
import { scoreFindings } from '../shared/scoring.js';

const GH = 'https://api.github.com';
const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'git-goat-readonly-scanner/0.1', 'X-GitHub-Api-Version': '2022-11-28' };
const maxTextBytes = 64 * 1024;
const maxFilesToRead = 180;
const maxTotalText = 6 * 1024 * 1024;

function parseUrl(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw Object.assign(new Error('Enter a valid public GitHub repository URL.'), { status: 400 }); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password) throw Object.assign(new Error('Only https://github.com/owner/repository URLs are supported.'), { status: 400 });
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw Object.assign(new Error('Include both the GitHub owner and repository name.'), { status: 400 });
  const owner = parts[0]; const name = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) throw Object.assign(new Error('Repository URL contains an unsupported owner or repository name.'), { status: 400 });
  return { owner, name };
}
async function githubJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const status = res.status === 404 ? 404 : res.status === 403 || res.status === 429 ? 429 : 502;
    const msg = res.status === 404 ? 'Repository not found or not publicly accessible.' : res.status === 429 ? 'GitHub API rate limit reached. Try again later or connect authorized access.' : `GitHub API returned HTTP ${res.status}.`;
    throw Object.assign(new Error(msg), { status });
  }
  return await res.json() as T;
}
type TreeEntry = { path: string; type: 'blob'|'tree'|'commit'; size?: number; mode: string };
function makeFinding(index: number, evidence: string[], status: Finding['status']): Finding {
  const [title, category, severity, candidates] = RULES[index]; const present=status==='VERIFIED_COMPLETE';const blocked=status==='BLOCKED';
  return {id:`R${String(index+1).padStart(2,'0')}`,title,category,severity:severity as Severity,status,detail:present?`Found repository evidence for ${title.toLowerCase()}. This confirms presence only, not operational quality.`:blocked?'This control cannot be confirmed through unauthenticated public repository contents.':`No matching repository evidence was found for ${title.toLowerCase()}.`,evidence:evidence.length?evidence.slice(0,5):[`Checked ${candidates.length?candidates.join(', '):'GitHub repository settings'}`],nextStep:present?'Review whether the control is enforced and current.':blocked?'Connect authorized repository access to inspect this control.':`Add and verify ${candidates[0]||'the required repository setting'}.`};
}
export async function scanPublicRepository(input:string):Promise<ScanReport>{
 const{owner,name}=parseUrl(input);const repoUrl=`${GH}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
 const meta=await githubJson<{full_name:string;default_branch:string;html_url:string;private:boolean;size:number}>(repoUrl);
 if(meta.private)throw Object.assign(new Error('Private repository access requires GitHub authorization, which is not configured.'),{status:401});
 if(meta.size>200*1024)throw Object.assign(new Error('GitHub reports this repository above 200 MiB; scan refused rather than return an incomplete inventory.'),{status:413});
 const branch=meta.default_branch;const branchData=await githubJson<{commit:{sha:string}}>(`${repoUrl}/branches/${encodeURIComponent(branch)}`);const commit=branchData.commit.sha;
 const tree=await githubJson<{tree:TreeEntry[];truncated:boolean}>(`${repoUrl}/git/trees/${encodeURIComponent(commit)}?recursive=1`);if(tree.truncated)throw Object.assign(new Error('GitHub truncated the repository tree; refusing to report an incomplete inventory.'),{status:413});
 const files=tree.tree.filter(x=>x.type==='blob');const findings:Finding[]=RULES.map(([title,, , candidates],i)=>{if(i===24)return makeFinding(i,[],'BLOCKED');const matched=files.filter(f=>candidates.some(c=>f.path.toLowerCase()===c.toLowerCase()||f.path.toLowerCase().startsWith(`${c.toLowerCase()}/`)));return makeFinding(i,matched.map(f=>f.path),matched.length?'VERIFIED_COMPLETE':'REMEDIATION_REQUIRED');});
 const sources=files.filter(f=>/\.(?:js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|json|ya?ml|toml|md|txt|env(?:\.example)?)$/i.test(f.path)&&(f.size??0)<=maxTextBytes&&!/^(?:vendor|node_modules|dist|build|coverage)\//i.test(f.path)).slice(0,maxFilesToRead);
 const exclusions:ScanReport['exclusions']=[];const content=new Map<string,string>();let total=0;for(const f of files)if(!sources.includes(f))exclusions.push({path:f.path,reason:'File inventoried from Git tree; content not fetched (type, size, generated/vendor directory, or scan limit).'});
 for(const file of sources){if(total>=maxTotalText){exclusions.push({path:file.path,reason:'Scan text budget reached (6 MiB); content not fetched.'});continue;}try{const r=await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${encodeURIComponent(commit)}/${file.path.split('/').map(encodeURIComponent).join('/')}`,{signal:AbortSignal.timeout(7000)});if(!r.ok){exclusions.push({path:file.path,reason:`Could not retrieve source (HTTP ${r.status}).`});continue;}const text=(await r.text()).slice(0,maxTextBytes);total+=Buffer.byteLength(text);content.set(file.path,text);}catch{exclusions.push({path:file.path,reason:'Source retrieval timed out or failed.'});}}
 const patterns=[/(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\s]{12,}["']/ig,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g];let secretCount=0;for(const[p,t]of content){if(/\.env\.example$|example\.env$|sample|template/i.test(p))continue;if(patterns.some(x=>{x.lastIndex=0;return x.test(t);}))secretCount++;}
 findings.unshift({id:'S01',title:'Potential hard-coded secrets',category:'Security',severity:'Critical',status:secretCount?'REMEDIATION_REQUIRED':'NOT RUN',detail:secretCount?`Potential credential patterns detected in ${secretCount} inspected file(s). This heuristic needs human confirmation.`:`No matching high-confidence patterns found in ${content.size} bounded text files. Heuristic is incomplete; secret cleanliness is NOT verified.`,evidence:secretCount?['Review source locally; the summary intentionally withholds matched paths.']:[`Inspected ${content.size} bounded text files; repository history was not scanned.`],nextStep:'Enable provider-native secret scanning and scan repository history; rotate any exposed credentials.'});
 const imports=[...content.entries()].filter(([p])=>/\.[cm]?[jt]sx?$/i.test(p)).flatMap(([path,text])=>[...text.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)].map(m=>({path,specifier:m[1]})));
 if(imports.length)findings.push({id:'D01',title:'JavaScript/TypeScript import graph',category:'Architecture',severity:'Low',status:'VERIFIED_COMPLETE',detail:`Extracted ${imports.length} import edges from bounded source files. This is a static approximation.`,evidence:imports.slice(0,8).map(x=>`${x.path} → ${x.specifier}`),nextStep:'Review dependency boundaries and unexpected external imports.'});
 const scored=scoreFindings(findings);const notes=[`Read-only scan pinned to commit ${commit}. No repository code was executed and no repository content was changed.`,`Inventoried ${files.length} files via Git Trees API; inspected ${content.size} text files (maximum 180 files and 6 MiB). File exclusions are enumerated.`,`This scanner does not download/extract an archive; size refusal uses GitHub's reported repository size, not measured compressed archive bytes.`,`Presence checks are not proof of effective controls. Branch protection, workflow outcomes, OSV advisories, repository-history secret scanning and test execution are not verified.`];
 return{id:randomUUID(),repository:meta.html_url,owner,name,commit,branch,scannedAt:new Date().toISOString(),files:files.length,exclusions:exclusions.slice(0,5000),findings,...scored,durability:process.env.MONGO_URL?'mongodb':'volatile',notes};
}
