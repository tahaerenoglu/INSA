/** Compare Node spec-reporter failure identities; do not mistake stack reason occurrences for test counts. */
import fs from 'node:fs';
const [baselinePath,finalPath,outputPath]=process.argv.slice(2);
if(!baselinePath||!finalPath||!outputPath)throw new Error('Usage: node scripts/compare-modeling-test-runs.mjs BASELINE FINAL OUTPUT.json');
function parse(file){
  const log=fs.readFileSync(file,'utf8').replace(/\u001b\[[0-9;]*m/g,'');
  const summary=Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(k=>[k,Number(log.match(new RegExp(`ℹ ${k} (\\d+)`))?.[1]??NaN)]));
  const failures=log.split(/(?:^|\r?\n)test at /).slice(1).map(block=>{
    const lines=block.split(/\r?\n/),file=lines[0].replace(/:\d+(?::\d+)?$/,'').replaceAll('\\','/');
    const name=lines[1].replace(/^✖ /,'').replace(/ \([\d.]+ms\)$/,'');
    const reason=block.match(/reason: ['"]([^'"]+)/)?.[1]??block.match(/Error \[([A-Z_]+)\]/)?.[1]??
      (block.includes('spawnSync')&&block.includes('ENOENT')?'WINDOWS_TSX_LAUNCH':block.includes('EPERM')&&block.includes('symlink')?'WINDOWS_SYMLINK_PERMISSION':
      block.includes('EPERM')&&block.includes('rename')?'WINDOWS_ATOMIC_RENAME':block.includes("'test failed'")?'FILE_OR_SUITE_WRAPPER':
      block.includes('TypeError')?'RESPONSE_SHAPE_TYPEERROR':block.includes('AssertionError')?'ASSERTION':block.includes('SyntaxError')?'MODULE_LOAD':'OTHER');
    const evidence=lines.find((line,i)=>i>1&&/Error|test failed/.test(line))?.trim();
    return {file,name,reason,evidence,key:`${file} :: ${name}`};
  });
  return {summary,failures};
}
const baseline=parse(baselinePath),final=parse(finalPath),oldKeys=new Set(baseline.failures.map(f=>f.key)),newKeys=new Set(final.failures.map(f=>f.key));
const oldReasons=new Map(baseline.failures.map(f=>[f.key,f.reason]));
const counts=rows=>rows.reduce((out,row)=>(out[row.reason]=(out[row.reason]??0)+1,out),{});
const report={baseline:{...baseline,mechanisms:counts(baseline.failures)},final:{...final,mechanisms:counts(final.failures)},
  added:final.failures.filter(f=>!oldKeys.has(f.key)),resolved:baseline.failures.filter(f=>!newKeys.has(f.key)),
  changedMechanisms:final.failures.filter(f=>oldReasons.has(f.key)&&oldReasons.get(f.key)!==f.reason).map(f=>({...f,baselineReason:oldReasons.get(f.key)}))};
fs.writeFileSync(outputPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({baseline:baseline.summary,final:final.summary,baselineMechanisms:counts(baseline.failures),finalMechanisms:counts(final.failures),added:report.added.length,resolved:report.resolved.length,changedMechanisms:report.changedMechanisms.length},null,2));
