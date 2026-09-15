#!/usr/bin/env node
'use strict';
// Delegate to the owning cycle path so authorization and fingerprint checks run.
const {spawnSync}=require('node:child_process');const path=require('node:path');
function main(args=process.argv.slice(2)){return spawnSync(process.execPath,[path.join(__dirname,'cycle-driver.cjs'),'research-tick',...args],{stdio:'inherit'}).status??1;}
module.exports={main};if(require.main===module)process.exitCode=main();
