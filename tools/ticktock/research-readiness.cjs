#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const io=require('../ant-hive-world/research/research-io.cjs');
function main(args=process.argv.slice(2)){const [charterPath,specPath,...rest]=args;if(!charterPath||!specPath||rest.length)throw new Error('Usage: research-readiness.cjs <charter.json> <research-spec.json>');const charter=JSON.parse(fs.readFileSync(charterPath,'utf8'));if(!require('./charter.cjs').validateCharter(charter).valid)throw new Error('invalid charter');return io.readiness({charterHash:charter.charter_hash,specPath});}
module.exports={main};if(require.main===module){try{console.log(JSON.stringify(main(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
