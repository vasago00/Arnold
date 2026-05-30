import { parse } from '@babel/parser';
import { readFileSync } from 'fs';
const files = [
  'src/Arnold.jsx',
  'src/components/MobileHome.jsx',
  'src/components/CoachComment.jsx',
];
for (const f of files) {
  try {
    parse(readFileSync(f, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx'],
      errorRecovery: false,
    });
    console.log('OK  ' + f);
  } catch (e) {
    console.log('ERR ' + f + '  -> ' + e.message + ' @ ' + (e.loc ? e.loc.line+':'+e.loc.column : '?'));
  }
}
