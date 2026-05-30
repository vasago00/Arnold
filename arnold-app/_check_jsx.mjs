import { parse } from '@babel/parser';
import { readFileSync } from 'fs';
const files = [
  'src/components/CoachComment.jsx',
  'src/components/CoachSigil.jsx',
  'src/components/CoachBeta.jsx',
  'src/components/MobileHome.jsx',
  'src/Arnold.jsx',
  'src/core/coachSignals.js',
  'src/core/narrativeComposer.js',
];
let allOk = true;
for (const f of files) {
  try {
    parse(readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    console.log('OK  ' + f);
  } catch (e) {
    allOk = false;
    console.log('ERR ' + f + '  -> ' + e.message);
  }
}
process.exit(allOk ? 0 : 1);
