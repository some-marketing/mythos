#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const io=require('../ant-hive-world/research/research-io.cjs');
function parseArgs(args) {
 const [charterPath,batchId,...rest]=args;const flags={};
 if(!charterPath||!batchId)throw new Error('Usage: research-prepare.cjs <charter.json> <batch-id> [--goal=RG-01] [--rounds=300] [--seeds=1701,2701,3701] [--max-wall-ms=300000] [--supersedes=prior-batch-id]');
 for(const arg of rest){const match=/^--(goal|rounds|seeds|max-wall-ms|supersedes)=(.+)$/.exec(arg);if(!match||Object.hasOwn(flags,match[1]))throw new Error('unknown, empty or duplicate prepare option: '+arg);flags[match[1]]=match[2];}
 const maxWallMs=flags['max-wall-ms']===undefined?300000:Number(flags['max-wall-ms']);
 if(!Number.isInteger(maxWallMs)||maxWallMs<1||maxWallMs>3600000)throw new Error('max-wall-ms must be an integer between 1 and 3600000');
 return {charterPath,batchId,goalId:flags.goal||'RG-01',rounds:flags.rounds===undefined?300:Number(flags.rounds),seeds:flags.seeds===undefined?[1701,2701,3701]:flags.seeds.split(',').map(Number),maxWallMs,supersedes:flags.supersedes||null};
}
function main(args=process.argv.slice(2)) {
 const {charterPath,...options}=parseArgs(args);
 const charter=JSON.parse(fs.readFileSync(charterPath,'utf8'));if(!require('./charter.cjs').validateCharter(charter).valid)throw new Error('invalid charter');
 return io.prepare({charterHash:charter.charter_hash,...options});
}
module.exports={main,parseArgs};if(require.main===module){try{console.log(JSON.stringify(main(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
