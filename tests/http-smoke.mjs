// Run after npm run build. Uses dummy credentials and only rejected requests;
// it never calls Razorpay or Supabase.
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {once} from 'node:events';
const port=Number(process.env.SMOKE_PORT||3187),base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{stdio:['ignore','pipe','pipe'],env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://smoke.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'dummy-service-key',RAZORPAY_WEBHOOK_SECRET:'dummy-webhook-secret',RAZORPAY_KEY_ID:'rzp_test_dummy',RAZORPAY_KEY_SECRET:'dummy-api-secret'}});
try {
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server did not start')),20000);child.on('exit',code=>{clearTimeout(timer);reject(Error(`Server exited: ${code}`));});child.stdout.on('data',data=>{if(String(data).includes('Ready')){clearTimeout(timer);resolve();}});child.stderr.on('data',data=>process.stderr.write(data));});
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body,signal:AbortSignal.timeout(5000)});
 assert.equal((await post('/api/razorpay/order','{}',{Origin:'https://untrusted.test'})).status,403);
 assert.equal((await post('/api/razorpay/order','not-json')).status,400);
 assert.equal((await post('/api/razorpay/order','{}')).status,400);
 assert.equal((await post('/api/razorpay/order','x'.repeat(9000))).status,413);
 assert.equal((await post('/api/razorpay/verify','{"token":"invalid"}')).status,400);
 const webhook=await post('/api/razorpay/webhook','{"event":"payment.captured"}',{'x-razorpay-signature':'forged'});
 assert.equal(webhook.status,400);assert.equal(webhook.headers.get('cache-control'),'no-store');
 console.log('PASS: 6 HTTP checks (cross-origin, malformed JSON, invalid identity, body limit, invalid verification, forged webhook/no-store)');
}finally{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
