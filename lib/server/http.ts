import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { PaymentError } from './razorpay';
export function serverDb() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!url || !key) throw new PaymentError('Server payment configuration is incomplete. Contact the site owner.',503);
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})}});
}
export function json(value:unknown,status=200) {return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export function failure(error:unknown) {return json({error:error instanceof PaymentError ? error.message : 'Payment request failed. Retry the same purchase or contact the site owner.'},error instanceof PaymentError ? error.status : 500);}
export function sameOrigin(req:Request) {
  const expected = new URL(req.url);
  // Next's internal URL can use localhost behind the server adapter. Host is
  // the browser-facing authority; never accept an arbitrary forwarded host.
  const host = req.headers.get('host');
  if (host) expected.host = host;
  if(req.headers.get('origin')!==expected.origin) throw new PaymentError('Cross-origin payment request rejected.',403);
}
export async function readBody(req:Request,max=8192) {
  if(!req.body) throw new PaymentError('Request body is required.');
  const reader=req.body.getReader();const decoder=new TextDecoder();let bytes=0;let text='';
  try {while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>max){await reader.cancel();throw new PaymentError('Request too large.',413);}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
  finally {reader.releaseLock();}
}
export async function input(req:Request) {
  sameOrigin(req);
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw new PaymentError('JSON is required.',415);
  try {const value:unknown=JSON.parse(await readBody(req));if(!value||typeof value!=='object'||Array.isArray(value))throw new PaymentError('Invalid request.');return value as Record<string,unknown>;}
  catch(e){if(e instanceof PaymentError)throw e;throw new PaymentError('Invalid JSON.');}
}
